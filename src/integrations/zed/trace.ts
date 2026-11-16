/**
 * Zed's own agent (the "Zed Agent" in the agent panel). Threads live in one
 * SQLite database, threads/threads.db in Zed's data folder (%LOCALAPPDATA%\Zed
 * on Windows, ~/Library/Application Support/Zed on macOS, $XDG_DATA_HOME/zed
 * elsewhere). Agents Zed runs over ACP (Claude Code, Codex, …) keep their own
 * logs, which their own adapters read.
 *
 * `threads` has `id`, `summary`, `updated_at`, `folder_paths`, `parent_id` and
 * `data`: the thread as JSON, zstd-compressed when `data_type` is "zstd".
 * `messages` is a list of `{ User: { content } }` and `{ Agent: { content,
 * tool_results } }`, where content items are `{ Text }` and `{ ToolUse: { id,
 * name, input: { value } } }`, and `tool_results` maps a tool use id to `{
 * is_error, content, output }`. Messages carry no timestamps, so every record
 * gets the thread's creation time: the start of the work, which keeps the
 * session's commits inside the PR's time window.
 *
 * Tools: `terminal` (`command`, `cd`), whose result text says "failed with exit
 * code N" on failure (`is_error` stays false) and wraps the output in a fence;
 * `edit_file` and `streaming_edit_file`, whose `output` holds `original_path`,
 * `old_text` and `new_text` (the whole file before and after).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { isSyntheticPrompt } from '@showtail/agent-traces/prompts/synthetic';
import { splitLines } from '../../trace/diffLines.ts';
import { sawToolCall, sawUnknownTool } from '../../trace/toolCalls.ts';
import type {
  SessionRef,
  TraceAdapter,
  TraceRecord,
  TraceSession,
} from '../../trace/types.ts';
import { openReadOnly } from '../../util/sqlite.ts';

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length ? v : undefined;

export function zedDataDir(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (env.ZED_DATA_DIR) return env.ZED_DATA_DIR;
  if (process.platform === 'win32')
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Zed');
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Zed');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'zed');
}

const dbPath = () => join(zedDataDir(), 'threads', 'threads.db');

/** Tools that don't change the repository. */
const QUIET = new Set([
  'read_file',
  'list_directory',
  'grep',
  'find_path',
  'diagnostics',
  'fetch',
  'web_search',
  'thinking',
  'now',
  'open',
  'skill',
  'project_notifications',
  'copy_path',
  'create_directory',
]);

/** zstd, from Bun or from Node 22.15+; undefined when neither offers it. */
function zstd(): ((data: Uint8Array) => Uint8Array) | undefined {
  const bun = (globalThis as any).Bun;
  if (typeof bun?.zstdDecompressSync === 'function')
    return (d) => bun.zstdDecompressSync(d);
  try {
    const zlib = createRequire(import.meta.url)('node:zlib');
    if (typeof zlib.zstdDecompressSync === 'function')
      return (d) => zlib.zstdDecompressSync(d);
  } catch {}
  return undefined;
}

/** The thread JSON from a row's `data`, or undefined with a warning. */
export function decodeThread(
  data: unknown,
  dataType: unknown,
  warnings: string[],
): Obj | undefined {
  try {
    let bytes: Uint8Array | string = data as any;
    if (dataType === 'zstd') {
      const un = zstd();
      if (!un) {
        warnings.push(
          'Zed threads are zstd-compressed and this runtime cannot read zstd.',
        );
        return undefined;
      }
      bytes = un(data as Uint8Array);
    }
    const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
    const j = JSON.parse(text);
    return isObj(j) ? j : undefined;
  } catch {
    warnings.push('Skipped a Zed thread that could not be decoded.');
    return undefined;
  }
}

/** Lines only in `after` (added) and only in `before` (removed), as multisets. */
export function lineChanges(before: string, after: string) {
  const count = new Map<string, number>();
  for (const l of splitLines(before)) count.set(l, (count.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of splitLines(after)) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) removed.push(l);
  return { added, removed };
}

const resultText = (r: Obj): string =>
  typeof r.output === 'string'
    ? r.output
    : Array.isArray(r.content)
      ? r.content
          .map((c: unknown) => (isObj(c) && typeof c.Text === 'string' ? c.Text : ''))
          .join('\n')
      : '';

/** A terminal result: exit code, and the fenced output without Zed's notes. */
export function terminalResult(text: string): { exit?: number; output: string } {
  const exit = /failed with exit code (-?\d+)/.exec(text);
  const fence = /```[^\n]*\n([\s\S]*?)\n?```/.exec(text);
  return {
    exit: exit ? Number(exit[1]) : undefined,
    output: (fence ? fence[1]! : '').trim(),
  };
}

/** Turn one thread into records. Exported for tests. */
export function parseZedThread(
  thread: Obj,
  into: TraceSession,
  cwd?: string,
  createdAt?: string,
): void {
  const ts =
    createdAt ??
    str(thread.initial_project_snapshot?.timestamp) ??
    str(thread.updated_at);
  const messages = Array.isArray(thread.messages) ? thread.messages.filter(isObj) : [];
  const results: Obj = {};
  for (const m of messages)
    if (isObj(m.Agent) && isObj(m.Agent.tool_results))
      Object.assign(results, m.Agent.tool_results);
  for (const m of messages) {
    const role = isObj(m.User) ? 'user' : isObj(m.Agent) ? 'agent' : undefined;
    if (!role) {
      const t = Object.keys(m)[0] ?? '?';
      into.unknownTypes[t] = (into.unknownTypes[t] ?? 0) + 1;
      continue;
    }
    const content = Array.isArray(m[role === 'user' ? 'User' : 'Agent'].content)
      ? m[role === 'user' ? 'User' : 'Agent'].content.filter(isObj)
      : [];
    for (const c of content) {
      if (typeof c.Text === 'string') {
        const text = c.Text.trim();
        if (!text) continue;
        if (role === 'user') {
          if (!isSyntheticPrompt(text))
            into.records.push({ kind: 'prompt', text, ts, cwd });
        } else into.records.push({ kind: 'assistant', text, ts, cwd });
        continue;
      }
      if (!isObj(c.ToolUse)) continue;
      const use = c.ToolUse;
      const name = str(use.name) ?? '';
      sawToolCall(into);
      const input: Obj = isObj(use.input?.value)
        ? use.input.value
        : (() => {
            try {
              const j = JSON.parse(use.raw_input ?? '');
              return isObj(j) ? j : {};
            } catch {
              return {};
            }
          })();
      const result: Obj | undefined = str(use.id) ? results[use.id] : undefined;
      if (name === 'terminal' && str(input.command)) {
        const rec: Extract<TraceRecord, { kind: 'command' }> = {
          kind: 'command',
          cmd: input.command,
          ts,
          cwd: str(input.cd) ?? cwd,
        };
        if (!result) rec.pending = true;
        else {
          const { exit, output } = terminalResult(resultText(result));
          if (result.is_error === true || (exit !== undefined && exit !== 0))
            rec.isError = true;
          if (output) rec.output = output.slice(0, 4000);
        }
        into.records.push(rec);
      } else if (
        (name === 'edit_file' || name === 'streaming_edit_file') &&
        isObj(result?.output) &&
        typeof result.output.new_text === 'string'
      ) {
        const out = result.output;
        const path = str(out.original_path) ?? str(input.path) ?? '';
        const file = isAbsolute(path) ? path : resolve(cwd ?? '.', path);
        const before = typeof out.old_text === 'string' ? out.old_text : '';
        const { added, removed } = lineChanges(before, out.new_text);
        into.records.push({
          kind: 'edit',
          file,
          added,
          removed,
          ...(before === '' && input.mode === 'create' ? { created: true } : {}),
          ts,
          cwd,
        });
      } else if (!QUIET.has(name)) sawUnknownTool(into, name);
    }
  }
}

interface Row {
  id: string;
  summary: string | null;
  updated_at: string;
  data_type: string;
  data: Uint8Array | string;
  created_at?: string | null;
  folder_paths: string | null;
  parent_id: string | null;
}

function rows(sql: string, ...params: unknown[]): Row[] {
  const file = dbPath();
  if (!existsSync(file)) return [];
  try {
    const db = openReadOnly(file);
    if (!db) return [];
    try {
      return db.all<Row>(sql, ...params);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

const within = (dir: string, root: string) => {
  const a = resolve(dir).toLowerCase();
  const b = resolve(root).toLowerCase();
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
};

/** The thread's folder (Zed may list several, one per line). */
const folders = (r: Row) =>
  (r.folder_paths ?? '')
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Folders the thread's commands ran in. */
function commandDirs(thread: Obj): string[] {
  const dirs: string[] = [];
  for (const m of Array.isArray(thread.messages) ? thread.messages : [])
    for (const c of isObj(m?.Agent) && Array.isArray(m.Agent.content)
      ? m.Agent.content
      : [])
      if (isObj(c?.ToolUse) && c.ToolUse.name === 'terminal') {
        const cd = str(c.ToolUse.input?.value?.cd);
        if (cd) dirs.push(cd);
      }
  return dirs;
}

export const zedAdapter: TraceAdapter = {
  id: 'zed',
  label: 'Zed',
  home: () => (existsSync(dbPath()) ? zedDataDir() : undefined),
  count: () => rows('select id from threads').length,
  discover(q) {
    const out: SessionRef[] = [];
    const since = new Date(q.sinceMs).toISOString();
    for (const r of rows(
      'select id, summary, updated_at, data_type, data, folder_paths, parent_id from threads where updated_at >= ?',
      since,
    )) {
      const dirs = folders(r);
      let cwd = dirs.find((d) => q.all || q.roots.some((root) => within(d, root)));
      if (!cwd && !q.all) {
        // Zed opened on a parent folder (often home): use where commands ran.
        const thread = decodeThread(r.data, r.data_type, []);
        cwd = thread
          ? commandDirs(thread).find((d) => q.roots.some((root) => within(d, root)))
          : undefined;
      }
      if (!cwd && !q.all) continue;
      out.push({
        agent: 'zed',
        sessionId: r.id,
        path: `${dbPath()}#${r.id}`,
        mtimeMs: Date.parse(r.updated_at) || 0,
        cwd: cwd ?? dirs[0],
      });
    }
    return out;
  },
  read(ref) {
    const session: TraceSession = {
      agent: 'zed',
      sessionId: ref.sessionId,
      source: ref.path,
      records: [],
      unknownTypes: {},
      warnings: [],
    };
    const r = rows(
      'select id, summary, updated_at, created_at, data_type, data, folder_paths, parent_id from threads where id = ?',
      ref.sessionId,
    )[0];
    if (!r) return session;
    if (r.summary) session.title = r.summary;
    if (r.parent_id) session.parentSessionId = r.parent_id;
    const thread = decodeThread(r.data, r.data_type, session.warnings);
    if (thread) parseZedThread(thread, session, ref.cwd, r.created_at ?? undefined);
    return session;
  },
};

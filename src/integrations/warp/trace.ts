/**
 * Warp's agent. Warp keeps the conversation itself on its servers; on disk,
 * warp.sqlite holds what ran in the terminal, which is enough for prompts and
 * commands (and so commits), not the agent's replies or the edits made by its
 * own diff tool.
 *
 * `agent_conversations` lists conversations (`conversation_id`,
 * `last_modified_at`, `summary` JSON with `title`); `ai_queries` holds each
 * prompt (`input` JSON: `[{ Query: { text, context } }]`, `start_ts`,
 * `working_directory`); `blocks` holds terminal commands, with `ai_metadata` (or
 * `agent_view_visibility`) naming the conversation that ran them, plus `pwd`,
 * `exit_code`, `start_ts` and ANSI-styled `stylized_command` and
 * `stylized_output`. Timestamps are UTC, as "YYYY-MM-DD HH:MM:SS.nnnnnnnnn".
 *
 * The database is %LOCALAPPDATA%\warp\Warp\data\warp.sqlite on Windows. The
 * macOS and Linux paths below follow Warp's layout but are not yet verified.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { isSyntheticPrompt } from '@showtail/agent-traces/prompts/synthetic';
import { sawToolCall } from '../../trace/toolCalls.ts';
import type { SessionRef, TraceAdapter, TraceSession } from '../../trace/types.ts';
import { openReadOnly } from '../../util/sqlite.ts';

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length ? v : undefined;

export function warpDbPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (env.WARP_DB_PATH) return env.WARP_DB_PATH;
  if (process.platform === 'win32')
    return join(
      env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
      'warp',
      'Warp',
      'data',
      'warp.sqlite',
    );
  if (process.platform === 'darwin')
    return join(
      home,
      'Library',
      'Group Containers',
      '2BBY89MBSN.dev.warp',
      'Library',
      'Application Support',
      'dev.warp.Warp-Stable',
      'warp.sqlite',
    );
  return join(
    env.XDG_STATE_HOME || join(home, '.local', 'state'),
    'warp-terminal',
    'warp.sqlite',
  );
}

const json = (v: unknown): any => {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

/** Warp's "2026-11-15 23:09:22.048653900" (UTC) as an ISO time. */
export function warpTime(v: unknown): string | undefined {
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d{1,3})?/.exec(String(v ?? ''));
  return m ? `${m[1]}T${m[2]}${m[3] ?? ''}Z` : undefined;
}

/** Terminal text without ANSI styling, decoded from bytes or a string. */
export function plain(v: unknown): string {
  const text =
    typeof v === 'string'
      ? v
      : v instanceof Uint8Array
        ? new TextDecoder().decode(v)
        : '';
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export interface WarpQuery {
  input: string | null;
  start_ts: string | null;
  working_directory: string | null;
}

export interface WarpBlock {
  pwd: string | null;
  exit_code: number | null;
  start_ts: string | null;
  ai_metadata: string | null;
  agent_view_visibility: string | null;
  stylized_command: Uint8Array | string | null;
  stylized_output: Uint8Array | string | null;
}

/** The conversation a block belongs to, when the agent ran it. */
export function blockConversation(b: WarpBlock): string | undefined {
  return (
    str(json(b.ai_metadata)?.conversation_id) ??
    str(json(b.agent_view_visibility)?.Agent?.origin_conversation_id)
  );
}

/** Turn one conversation's prompts and agent-run commands into records. Exported for tests. */
export function parseWarp(
  queries: WarpQuery[],
  blocks: WarpBlock[],
  into: TraceSession,
): void {
  for (const q of queries) {
    const items = json(q.input);
    for (const item of Array.isArray(items) ? items : []) {
      const text = str(item?.Query?.text)?.trim();
      if (!text || isSyntheticPrompt(text)) continue;
      into.records.push({
        kind: 'prompt',
        text,
        ts: warpTime(q.start_ts),
        cwd: str(q.working_directory),
      });
    }
  }
  for (const b of blocks) {
    const cmd = plain(b.stylized_command);
    if (!cmd) continue;
    sawToolCall(into);
    const output = plain(b.stylized_output);
    into.records.push({
      kind: 'command',
      cmd,
      ts: warpTime(b.start_ts),
      cwd: str(b.pwd),
      ...(typeof b.exit_code === 'number' && b.exit_code !== 0 ? { isError: true } : {}),
      ...(output ? { output: output.slice(0, 4000) } : {}),
    });
  }
  into.records.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
}

function query<T>(sql: string, ...params: unknown[]): T[] {
  const file = warpDbPath();
  if (!existsSync(file)) return [];
  try {
    const db = openReadOnly(file);
    if (!db) return [];
    try {
      return db.all<T>(sql, ...params);
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

const BLOCKS =
  'select pwd, exit_code, start_ts, ai_metadata, agent_view_visibility, stylized_command, stylized_output from blocks where ai_metadata is not null or agent_view_visibility like \'%"Agent"%\' order by start_ts';

/** The agent-run blocks, grouped by conversation. */
function agentBlocks(): Map<string, WarpBlock[]> {
  const by = new Map<string, WarpBlock[]>();
  for (const b of query<WarpBlock>(BLOCKS)) {
    const id = blockConversation(b);
    if (id) by.set(id, [...(by.get(id) ?? []), b]);
  }
  return by;
}

export const warpAdapter: TraceAdapter = {
  id: 'warp',
  label: 'Warp',
  home: () => (existsSync(warpDbPath()) ? warpDbPath() : undefined),
  count: () =>
    Number(
      query<{ n: number }>('select count(*) as n from agent_conversations')[0]?.n ?? 0,
    ),
  discover(q) {
    const blocks = agentBlocks();
    const out: SessionRef[] = [];
    for (const c of query<{ conversation_id: string; last_modified_at: string }>(
      'select conversation_id, last_modified_at from agent_conversations',
    )) {
      const mtimeMs = Date.parse(warpTime(c.last_modified_at) ?? '') || 0;
      if (mtimeMs < q.sinceMs && !q.all) continue;
      const mine = blocks.get(c.conversation_id) ?? [];
      // A command counts for the repository when it ran there or names it.
      const cwd = mine
        .map((b) => {
          const dir = str(b.pwd);
          if (dir && q.roots.some((r) => within(dir, r))) return dir;
          const cmd = plain(b.stylized_command).toLowerCase();
          return q.roots.find((r) => cmd.includes(resolve(r).toLowerCase()));
        })
        .find(Boolean);
      if (!cwd && !q.all) continue;
      out.push({
        agent: 'warp',
        sessionId: c.conversation_id,
        path: `${warpDbPath()}#${c.conversation_id}`,
        mtimeMs,
        cwd,
      });
    }
    return out;
  },
  read(ref) {
    const session: TraceSession = {
      agent: 'warp',
      sessionId: ref.sessionId,
      source: ref.path,
      records: [],
      unknownTypes: {},
      warnings: [],
    };
    const summary = json(
      query<{ summary: string }>(
        'select summary from agent_conversations where conversation_id = ?',
        ref.sessionId,
      )[0]?.summary,
    );
    if (str(summary?.title)) session.title = summary.title;
    parseWarp(
      query<WarpQuery>(
        'select input, start_ts, working_directory from ai_queries where conversation_id = ? order by start_ts',
        ref.sessionId,
      ),
      agentBlocks().get(ref.sessionId) ?? [],
      session,
    );
    return session;
  },
};

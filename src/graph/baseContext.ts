/**
 * What a changed function did before, from the base tree, when the patch's
 * removed lines don't show it: a hunk that only adds lines (a new branch in
 * front of an existing order, a new fallback) leaves the old behavior in
 * unchanged base code. For such hunks the enclosing function is read from
 * `git show <mergeBase>:<path>` and its key lines (conditions, returns,
 * orderings) are kept as `before` on the Hunk node.
 *
 * Fails open: a missing base, a new file or any git error gives no `before`.
 */
import { fileRole } from '../digest/build.ts';
import { git } from '../util/exec.ts';
import type { EvidenceGraph } from './model.ts';

const MAX_HUNKS = 16;
const MAX_LINES = 4;
const MAX_BODY = 80;
/** A line that decides what the function does. */
const KEY =
  /^\s*(?:(?:\}\s*)?(?:if|else|elif|switch|case|match|for|while)\b|return\s+\S(?!\s*$)|throw\b|raise\b)|\?\?|\.sort(?:ed)?\(/;
/** Conditions decide most; orderings next; returns last. */
const rankOf = (l: string) =>
  /^\s*(?:\}\s*)?(?:if|else|elif|switch|case|match)\b|\?\?/.test(l)
    ? 0
    : /sort/.test(l)
      ? 1
      : 2;

/** A line that defines a function or method. */
const DEF =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\b|def\s|fn\s|func\s|(?:pub(?:\(\w+\))?\s+)?fn\s|(?:public|private|protected|static|override|suspend)\s[\w<>\[\], ]*\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$)/;

/** (file, new start) → old start, from the patch's hunk headers. */
export function oldStarts(patch: string): Map<string, number> {
  const out = new Map<string, number>();
  let file: string | undefined;
  for (const line of patch.split('\n')) {
    const f = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (f) {
      file = f[1] === '/dev/null' ? undefined : f[1]!.trim();
      continue;
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (h && file) out.set(`${file}\0${Number(h[2])}`, Number(h[1]));
  }
  return out;
}

const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, '    ').length;

/**
 * The key lines of the function that encloses `oldStart` in `base`: from the
 * line git named as the hunk's context (the nearest definition above it) to
 * where its indentation closes.
 */
export function enclosingKeyLines(
  base: string[],
  context: string,
  oldStart: number,
  prefer: Map<string, number> = new Map(),
): string[] {
  const want = context.trim().replace(/…$/, '');
  // The first changed line sits after git's (up to) three context lines.
  const from = Math.min(oldStart - 1 + 3, base.length - 1);
  let at = -1;
  // The nearest definition above the change that encloses it (by indentation);
  // else the line git named as the hunk's context.
  const target = indentOf(base[from] ?? '');
  for (let i = from; i >= 0 && at < 0; i--)
    if (DEF.test(base[i]!) && indentOf(base[i]!) < target) at = i;
  if (at < 0 && want)
    for (let i = from; i >= 0; i--)
      if (base[i]!.trim().startsWith(want)) {
        at = i;
        break;
      }
  if (at < 0) return [];
  const indent = indentOf(base[at]!);
  const body: { l: string; i: number }[] = [];
  for (let i = at + 1; i < base.length && body.length < MAX_BODY; i++) {
    const l = base[i]!;
    if (l.trim() && indentOf(l) <= indent && !/^\s*[)}\]]/.test(l)) break;
    body.push({ l, i });
    // A closing brace at the definition's indent ends it; a `) {` closing a
    // multi-line signature does not.
    if (l.trim() && indentOf(l) <= indent && /^\s*[}\]]/.test(l)) break;
  }
  // Lines of a multi-line signature (parameter defaults) are not the body.
  const opened = [{ l: base[at]!, i: at }, ...body].find(({ l }) => /[{:]\s*$/.test(l));
  const bodyStart = opened?.i ?? at;
  const keys = body.filter(
    ({ l, i }) =>
      i > bodyStart &&
      KEY.test(l) &&
      !/^\s*(?:\/\/|#|\*)/.test(l) &&
      l.trim().length > 3 &&
      !/^[{}()[\];,]+$/.test(l.trim()) &&
      !/^return\s*[{([]\s*$/.test(l.trim()),
  );
  // The lines at and after the change first (what the new code now precedes
  // or replaces), then the function's opening lines; kept in source order.
  const near = keys.filter(({ i }) => i >= oldStart - 1 && i <= oldStart + 20);
  // Lines naming what the PR changes or what the session saw failing come
  // first: the condition a fix is about, not the function's first branch.
  const score = (l: string) =>
    [...new Set(tokensOf(l))].reduce((n, w) => n + (prefer.get(w) ?? 0), 0);
  const byRank = (xs: typeof keys) =>
    [...xs].sort((a, b) => rankOf(a.l) - rankOf(b.l) || a.i - b.i);
  const ranked = [...byRank(near), ...byRank(keys.filter((k) => !near.includes(k)))];
  const picked = ranked
    .map((k, order) => ({ ...k, order, s: score(k.l) }))
    .sort((a, b) => b.s - a.s || a.order - b.order)
    .slice(0, MAX_LINES)
    .sort((a, b) => a.i - b.i);
  return picked
    .map(({ l }) => l.trim())
    .map((l) => (l.length > 120 ? `${l.slice(0, 119)}…` : l));
}

/** Words too common in code to tell one condition from another. */
const COMMON = new Set(
  'const let var return if else true false null undefined new this await async function the and for not'.split(' '),
);
/** Lowercased identifier pieces of a line (`apt-get` → apt, get). */
export const tokensOf = (l: string): string[] =>
  (l.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !COMMON.has(w));

/**
 * Words that point at the condition a PR is about: the hunk's changed lines
 * (weight 1) and the failure text the session recorded (failed runs' result
 * lines, failed commands, user prompts quoting an error; weight 2).
 */
export function preferredWords(
  graph: EvidenceGraph,
  hunkWords: string[],
  failureWords: Map<string, number> = failureWordsOf(graph),
): Map<string, number> {
  const m = new Map(failureWords);
  for (const w of new Set(hunkWords.flatMap((x) => tokensOf(String(x)))))
    m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** Words of the session's failure text, each weighted 2. */
export function failureWordsOf(graph: EvidenceGraph): Map<string, number> {
  const m = new Map<string, number>();
  const failure: string[] = [];
  for (const n of graph.nodes) {
    const p = n.props;
    if (n.label === 'Run' && p.outcome === 'failed')
      failure.push(...((p.summary as string[]) ?? []).map(String));
    if (n.label === 'Session')
      failure.push(...((p.failedCmds as string[]) ?? []).map(String));
    if (n.label === 'Prompt' && FAILURE_TEXT.test(String(p.text ?? '')))
      failure.push(
        ...String(p.text)
          .split(/(?<=[.!?\n])\s+/)
          .filter((x) => FAILURE_TEXT.test(x)),
      );
  }
  for (const w of failure.flatMap(tokensOf)) m.set(w, 2);
  return m;
}
const FAILURE_TEXT =
  /\b(?:error|fail(?:s|ed|ure)?|not found|cannot|can't|couldn't|exception|denied|read-only|missing|broken|crash(?:es|ed)?)\b/i;

/** Adds `before` (key lines of the enclosing base function) to adding-only hunks. */
export function addBaseContext(
  graph: EvidenceGraph,
  toplevel: string,
  mergeBase: string | undefined,
  patch: string,
): void {
  if (!mergeBase) return;
  const starts = oldStarts(patch);
  const files = new Map<string, string[] | null>();
  const read = (path: string) => {
    if (!files.has(path)) {
      const r = git(toplevel, ['show', `${mergeBase}:${path}`]);
      files.set(path, r.ok ? r.stdout.split('\n') : null);
    }
    return files.get(path);
  };
  let n = 0;
  const failure = failureWordsOf(graph);
  for (const h of graph.nodes) {
    if (n >= MAX_HUNKS) break;
    if (h.label !== 'Hunk') continue;
    const p = h.props;
    const file = String(p.file ?? '');
    if (fileRole(file) !== 'behavior') continue;
    const added = Number(p.added ?? 0);
    const removed = Number(p.removed ?? 0);
    // Removed lines that show the old behavior already: `was` says it.
    if (!added || removed > Math.max(1, added / 4)) continue;
    const oldStart = starts.get(`${file}\0${Number(p.start)}`);
    if (!oldStart) continue;
    const base = read(file);
    if (!base) continue;
    const lines = enclosingKeyLines(
      base,
      String(p.context),
      oldStart,
      preferredWords(graph, ((p.words as string[]) ?? []).map(String), failure),
    );
    if (!lines.length) continue;
    p.before = lines;
    n++;
  }
}

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
  /^\s*(?:if\b|else\b|elif\b|switch\b|case\b|match\b|return\b|for\b|while\b|throw\b|raise\b)|\?\?|\.sort\(|\.sorted\(|\bsort\b|\bdefault\b|\bfallback\b|[^=!<>]=[^=>].*\?.*:/;

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
  const body: string[] = [];
  for (let i = at + 1; i < base.length && body.length < MAX_BODY; i++) {
    const l = base[i]!;
    if (l.trim() && indentOf(l) <= indent && !/^\s*[)}\]]/.test(l)) break;
    body.push(l);
    if (l.trim() && indentOf(l) <= indent) break;
  }
  return body
    .filter((l) => KEY.test(l) && !/^\s*(?:\/\/|#|\*)/.test(l))
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !/^[{}()[\];,]+$/.test(l))
    .slice(0, MAX_LINES)
    .map((l) => (l.length > 120 ? `${l.slice(0, 119)}…` : l));
}

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
    const lines = enclosingKeyLines(base, String(p.context), oldStart);
    if (!lines.length) continue;
    p.before = lines;
    n++;
  }
}

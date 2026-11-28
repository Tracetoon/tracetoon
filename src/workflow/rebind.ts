/**
 * Publish's automatic review rebind. With `Review recheck: none.` the drafter
 * applies the reviewers' findings in one edit pass and no reviewer looks
 * again, so binding review.json to the final render is bookkeeping, not a
 * review step. Writers often forgot it (`review import --rebind`, then render)
 * and publish refused the PR as "review stale". Publish now does that
 * bookkeeping itself when it is safe:
 *
 * - the plan's recheck is `none`;
 * - body.md is what the last render froze (no unrendered edits slip in);
 * - every imported pass reviewed the same code tree (or, for passes imported
 *   before trees were recorded, the same diff) as the render; a branch whose
 *   tree matches the reviewed head counts as the same code. Passes on earlier
 *   code are superseded once the passes on the current code meet the review
 *   plan by themselves (a fix committed after a review, then fresh passes);
 *   the rebind archives them in review-passes-superseded.json;
 * - the body did not grow past what the reviewers saw: at most half of its
 *   words are new compared with the last reviewed body.
 *
 * Anything else still refuses, with the reason.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '../run.ts';
import { readJson, writeJson } from '../run.ts';
import { objectHash } from '../contribution/guidance.ts';
import { loadReviewPlan, planMissing, planRecheck } from '../contribution/reviewPlan.ts';
import {
  importLeanReview,
  loadPasses,
  PASSES_FILE,
  treeOf,
  type StoredPass,
} from '../commands/review.ts';

/** Where the rebind keeps passes that newer passes on the current code replaced. */
export const SUPERSEDED_FILE = 'review-passes-superseded.json';

/**
 * The imported passes split by whether they reviewed the code the last render
 * shows: the same tree, or (for passes imported before trees were recorded)
 * the same diff. Undefined when the last render wrote no review input.
 */
export function passesByCode(
  run: Run,
  root: string,
): { current: StoredPass[]; earlier: StoredPass[] } | undefined {
  const input = readJson<{ headSha?: string; diffSha256?: string }>(
    run,
    'review-input.json',
  );
  if (!input?.headSha) return undefined;
  const tree = treeOf(root, input.headSha);
  const onCode = (p: StoredPass) =>
    !!(
      (p.treeSha && tree && p.treeSha === tree) ||
      (!p.treeSha && p.diffSha256 && p.diffSha256 === input.diffSha256)
    );
  const passes = loadPasses(run);
  return {
    current: passes.filter(onCode),
    earlier: passes.filter((p) => !onCode(p)),
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Whether the last render's review result no longer matches review.json or the render. */
export function reviewOutOfDate(run: Run): boolean {
  const input = readJson<{ fingerprint?: string }>(run, 'review-input.json');
  const review = readJson<{ inputFingerprint?: string }>(run, 'review.json');
  const result = readJson<{ reportSha256?: string; status?: string }>(
    run,
    'review-result.json',
  );
  if (!input || !review || !result) return false;
  if (result.status === 'skipped') return false;
  return (
    input.fingerprint !== review.inputFingerprint ||
    result.reportSha256 !== objectHash(review)
  );
}

/** Share of the words in `now` that `before` doesn't have (as a multiset). */
export function newWordShare(before: string, now: string): number {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_`.-]+/gu) ?? [];
  const pool = new Map<string, number>();
  for (const w of words(before)) pool.set(w, (pool.get(w) ?? 0) + 1);
  const current = words(now);
  if (!current.length) return 0;
  let fresh = 0;
  for (const w of current) {
    const n = pool.get(w) ?? 0;
    if (n > 0) pool.set(w, n - 1);
    else fresh++;
  }
  return fresh / Math.max(1, words(before).length);
}

/**
 * The description without the comic: its image, its transcript and the meta
 * line that records it. A comic drawn beside the review (or after it) adds
 * many words the reviewers never had to check; they are not description.
 */
export function withoutComic(body: string): string {
  return body
    .replace(/<p align="center"><img src="\{\{tracetoon:comic-src\}\}"[^\n]*<\/p>/g, '')
    .replace(/<details>\s*<summary>Comic transcript<\/summary>[\s\S]*?<\/details>/g, '')
    .replace(/<!-- tracetoon:meta [^\n]*-->/g, '');
}

/** Most of the body may change in the correction round; not more than this share may be new. */
export const MAX_NEW_WORDS = 0.5;

/**
 * Why publish may not rebind the review itself; undefined when it may.
 * `body` is body.md now; `sourceSha` is the body.md the last render froze.
 */
export function rebindProblem(
  run: Run,
  root: string,
  body: string | undefined,
  sourceSha: string | undefined,
): string | undefined {
  const plan = loadReviewPlan(run);
  if (planRecheck(plan) !== 'none')
    return 'the review plan asks for a recheck (Review recheck is not none)';
  if (body === undefined || !sourceSha || sha(body) !== sourceSha)
    return 'body.md changed after the last render';
  const passes = loadPasses(run);
  if (!passes.length) return 'no reviewer pass has been imported';
  const input = readJson<{ headSha?: string; diffSha256?: string; body?: string }>(
    run,
    'review-input.json',
  );
  if (!input?.headSha) return 'the last render wrote no review input';
  const { current, earlier } = passesByCode(run, root)!;
  if (earlier.length) {
    const first = `reviewer pass ${earlier[0]!.pass} reviewed different code`;
    if (!current.length) return first;
    // Fresh passes on the current code replace the earlier ones only when
    // they meet the review plan by themselves.
    const missing = planMissing(plan, current);
    if (missing.length)
      return `${first}, and the passes on the current code don't meet the review plan yet: ${missing.join('; ')}`;
  }
  const latest = [...current]
    .filter((p) => p.reviewedBody)
    .sort((a, b) => a.importedAt.localeCompare(b.importedAt))
    .at(-1);
  if (latest?.reviewedBody && input.body) {
    const share = newWordShare(
      withoutComic(latest.reviewedBody),
      withoutComic(input.body),
    );
    if (share > MAX_NEW_WORDS)
      return `${Math.round(share * 100)}% of the description is new since the last review`;
  }
  return undefined;
}

/**
 * Rebuild review.json from the imported passes for the current render
 * (`review import --rebind`); the caller renders again afterwards.
 */
export function rebindReview(run: Run, root: string): void {
  const split = passesByCode(run, root);
  if (split?.earlier.length && split.current.length) {
    // Superseded passes stay on record, outside the passes the review uses.
    const kept = readJson<{ passes?: StoredPass[] }>(run, SUPERSEDED_FILE)?.passes ?? [];
    writeJson(run, SUPERSEDED_FILE, { v: 1, passes: [...kept, ...split.earlier] });
    writeJson(run, PASSES_FILE, { v: 1, passes: split.current });
  }
  importLeanReview(run, root, { rebind: true });
}

/** body.md as it is now, if any. */
export function currentBody(run: Run): string | undefined {
  const file = join(run.dir, 'body.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

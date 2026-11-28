/**
 * `tracetoon finish --run <id>`: one call for the steps between drafting and
 * publishing, so a writer doesn't spend a model turn (and a re-read of its
 * whole context) on each of render --check, render, review-packet(s), review
 * merge and the rebind. It renders once (the brief check runs inside render),
 * and then, by where the run stands:
 *
 * - brief check open or leak scan tripped: what to fix, then finish again;
 * - no reviewer pass yet: writes the review packets the plan needs (or, with
 *   the Tracetoon runner, names `review run --all`) and the exact next step;
 * - passes imported on this body: the merged findings list to apply in one
 *   edit pass, then finish again;
 * - after the correction round: binds the review to the final render when
 *   `Review recheck: none.` (as publish would), else names the recheck;
 * - review current and the plan met: `tracetoon publish --run <id>`.
 *
 * Output is a few lines; `--verbose` also prints render's full report and
 * `--json` the structured result. Existing commands keep working.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson, type Run } from '../run.ts';
import { emit, type OutOpts } from './output.ts';
import { renderCmd, type Approval } from './publish.ts';
import { leakBlocks, leakNotice } from '../review/leak.ts';
import {
  loadReviewPlan,
  planEnforced,
  planMissing,
  planRecheck,
  planSummary,
  recheckStep,
  requiredPasses,
  tracetoonRuns,
  type ReviewPass,
  type ReviewPlan,
} from '../contribution/reviewPlan.ts';
import {
  lensFindingsFile,
  loadPasses,
  openRun,
  writeLeanPacket,
  writeMergedList,
} from './review.ts';
import {
  currentBody,
  rebindProblem,
  rebindReview,
  reviewOutOfDate,
} from '../workflow/rebind.ts';
import { hostAgent } from '../util/host.ts';
import { BLOCKING_RULE } from '../workflow/blocking.ts';
import { readLocal, writeLocal } from '../util/localJson.ts';

export { BLOCKING_RULE } from '../workflow/blocking.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Brief-check rounds finish stops for before it goes on to review (SKILL: up to three). */
export const MAX_BRIEF_ROUNDS = 3;
/** How many times finish stopped on the brief check for this run (counting this one when `bump`). */
function briefRounds(run: Run, bump: boolean): number {
  const file = join(run.dir, 'finish-rounds.json');
  const n = (readLocal<{ brief?: number }>(file)?.brief ?? 0) + (bump ? 1 : 0);
  if (bump) writeLocal(file, { brief: n });
  return n;
}

export interface FinishOpts extends OutOpts {
  run?: string;
  verbose?: boolean;
}

interface Packets {
  files: string[];
  imports: string[];
}

/** The review packets the plan's reviewer agents need, and how to import each. */
function writePackets(run: Run, plan: ReviewPlan | undefined): Packets {
  const r = run;
  const files: string[] = [];
  const imports: string[] = [];
  const flags = planEnforced(plan)
    ? `${plan.reviewerModel ? ` --reviewer-model ${plan.reviewerModel}` : ''}${plan.reviewerEffort ? ` --reviewer-effort ${plan.reviewerEffort}` : ''}`
    : '';
  const lenses = plan?.lenses ?? [];
  for (const lens of lenses) {
    files.push(writeLeanPacket(r, lens).path);
    imports.push(
      `tracetoon review import --run ${run.id} --lens ${lens} --agent-id <its id>${flags} (it writes ${lensFindingsFile(lens)})`,
    );
  }
  const general = plan ? requiredPasses(plan) - lenses.length : 1;
  if (general > 0 || !lenses.length) {
    files.push(writeLeanPacket(r).path);
    imports.push(
      `tracetoon review import --run ${run.id} --agent-id <its id>${flags}${general > 1 ? ` (once per general reviewer, each with its own findings file via --findings)` : ''}`,
    );
  }
  return { files, imports };
}

export function finishCmd(cwd: string, opts: FinishOpts): void {
  const { run, root } = openRun(cwd, opts.run);
  let brief: { brief: string; open: number; uncovered: number; tags: number } | undefined;
  const render = () =>
    renderCmd(cwd, {
      json: opts.json,
      run: run.id,
      quiet: !opts.verbose || !!opts.json,
      report: (r) => (brief = r),
    });
  let approval: Approval = render();
  const plan = loadReviewPlan(run);
  const did: string[] = [];
  const lines: string[] = [];
  let next: string;
  let packets: Packets | undefined;
  let merged: ReturnType<typeof writeMergedList> | undefined;
  const publish = `tracetoon publish --run ${run.id}`;
  const again = `tracetoon finish --run ${run.id}`;
  const host = hostAgent();
  const missingNow = () =>
    planMissing(plan, readJson<{ passes?: ReviewPass[] }>(run, 'review.json')?.passes);
  if (leakBlocks(approval)) {
    lines.push(leakNotice(approval));
    next = `fix what the leak scan found in body.md, then ${again}`;
  } else if (
    brief &&
    brief.tags &&
    (brief.open || brief.uncovered) &&
    briefRounds(run, true) <= MAX_BRIEF_ROUNDS
  ) {
    lines.push(brief.brief);
    next = `edit body.md (fix every listed sentence, cover every listed row), then ${again}`;
  } else {
    if (brief?.tags && (brief.open || brief.uncovered))
      lines.push(
        `Brief check: ${brief.open} sentence(s) and ${brief.uncovered} row(s) still listed after ${MAX_BRIEF_ROUNDS} rounds; going on to review (\`tracetoon render --check --run ${run.id}\` lists them).`,
      );
    const passes = loadPasses(run);
    const bodyNow = readJson<{ body?: string }>(run, 'review-input.json')?.body ?? '';
    if (!passes.length) {
      if (tracetoonRuns(plan)) {
        next = `\`tracetoon review run --all --run ${run.id}\` (Tracetoon starts every planned reviewer pass on ${plan!.reviewerModel} in parallel, imports each and writes one merged list; don't start a reviewer agent). ${BLOCKING_RULE} Then apply the merged list in ONE edit pass of body.md and ${again}.`;
      } else {
        packets = writePackets(run, plan);
        did.push(`wrote ${packets.files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`);
        const settings = planEnforced(plan)
          ? `${plan.reviewerModel ? ` on model ${plan.reviewerModel}` : ''}${plan.reviewerEffort ? ` at effort ${plan.reviewerEffort}` : ''}`
          : '';
        const n = plan && planEnforced(plan) ? requiredPasses(plan) : 1;
        next = `start ${n === 1 ? 'one fresh independent reviewer' : `${n} fresh independent reviewers (one per packet${plan && requiredPasses(plan) - plan.lenses.length > 1 ? '; general reviewers share review-packet.md' : ''}) IN PARALLEL, all in one message`} (not a fork)${settings}${host === 'claude' ? ' (Claude Code: foreground Agent calls, never run_in_background)' : host === 'codex' ? ' (Codex: spawn_agent with fork_turns "none")' : ''}; each gets its packet followed by ${plan?.lenses.length ? 'references/reviewer-lens-<lens>.md (lens packets) or ' : ''}references/reviewer-lean.md; then import each: ${packets.imports.join('; ')}; then ${again}.`;
      }
    } else {
      const latestBody = [...passes]
        .sort((a, b) => a.importedAt.localeCompare(b.importedAt))
        .at(-1)?.bodySha256;
      const uncorrected = latestBody === sha(bodyNow);
      const missing = missingNow();
      if (missing.length) {
        next = `${tracetoonRuns(plan) ? `\`tracetoon review run --all --run ${run.id}\` (runs only the missing passes). ${BLOCKING_RULE}` : `import the missing reviewer pass(es) with tracetoon review import --run ${run.id} --agent-id <its id>`}; then ${again}. Review plan still needs: ${missing.join('; ')}`;
      } else if (uncorrected) {
        merged = writeMergedList(run);
        if (merged.items.length) {
          lines.push(merged.text.trimEnd());
          next = `apply ${merged.path.split(/[\\/]/).pop()} in ONE edit pass of body.md (check each finding against the lines it cites; fix or reject every flagged claim; write fixes from the patch, not the reviewer's wording), then ${again}`;
        } else next = publish;
      } else {
        if (reviewOutOfDate(run)) {
          const why = rebindProblem(run, root, currentBody(run), approval.sourceSha);
          if (!why) {
            rebindReview(run, root);
            approval = render();
            did.push('bound the review to this render (Review recheck: none)');
          } else if (planRecheck(plan) === 'none')
            lines.push(`Can't bind the review to this render: ${why}.`);
        }
        next = reviewOutOfDate(run)
          ? `${recheckStep(run.id, plan)}; then ${again}`
          : publish;
      }
    }
  }
  const status = readJson<{ status?: string }>(run, 'review-result.json')?.status;
  // On the reviewed brief path the stored status is the older contribution review's
  // ("incomplete": no guidance, no inline comic assessment), which publish doesn't
  // gate on. The review plan is the gate, so say that when it is enforced and met.
  const reviewWord =
    planEnforced(plan) && !missingNow().length && !reviewOutOfDate(run) ? 'plan met' : (status ?? 'none');
  const head = `Rendered "${approval.title}" (${approval.mode === 'edit' ? `update PR #${approval.prNumber}` : `new PR, base ${approval.base}`}); leak scan: ${approval.findings.length ? (approval.allowFindings ? 'allowed findings' : 'FOUND something') : 'clean'}; brief check: ${brief ? (brief.open || brief.uncovered ? `${brief.open} to fix, ${brief.uncovered} to cover` : 'clean') : 'n/a'}; review: ${reviewWord}.`;
  const planLine = planEnforced(plan)
    ? ((m) => (m.length ? '' : `Review plan (${planSummary(plan)}): met.`))(missingNow())
    : '';
  emit(
    opts,
    {
      run: run.id,
      title: approval.title,
      mode: approval.mode,
      base: approval.base,
      leakFindings: approval.findings,
      briefCheck: brief ? { open: brief.open, uncovered: brief.uncovered } : null,
      review: status ?? null,
      did,
      ...(packets ? { packets: packets.files } : {}),
      ...(merged ? { mergedPath: merged.path, merged: merged.items.length } : {}),
      planMissing: missingNow(),
      finalBody: join(run.dir, 'final-body.md'),
      next,
    },
    () =>
      [
        head,
        did.length ? `Done: ${did.join('; ')}.` : '',
        ...lines,
        planLine,
        `Next: ${next}`,
      ]
        .filter(Boolean)
        .join('\n'),
  );
}

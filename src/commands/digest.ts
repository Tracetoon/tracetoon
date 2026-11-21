import { createHash } from 'node:crypto';
import { BLOCKING_RULE, QUICK_RULE } from '../workflow/blocking.ts';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeResearchPacket } from '../contribution/guidance.ts';
import { loadConfig } from '../config.ts';
import { buildDigestPair, type TraceDigest } from '../digest/build.ts';
import { findPrTemplate, detectAiPolicy } from '../github/repoContext.ts';
import { decodeMeta, humanPart, regionContent, regionEdited } from '../github/body.ts';
import { prTruth, type PrTruth } from '../git/pr.ts';
import { scan, type ScanResult } from '../pipeline.ts';
import { recentComics } from '../github/history.ts';
import { describeTitleRules, readTitleRules } from '../github/titleRules.ts';
import { assertRunOwner, findRun, newRun, readJson, writeJson } from '../run.ts';
import { recordTiming } from '../workflow/publication.ts';
import { emit, UserError, type OutOpts } from './output.ts';
import { submissionSnapshot } from '../review/snapshot.ts';
import { checkReport, receiptEvidence } from '../workflow/checks.ts';
import { detectInterop } from '../git/interop.ts';
import { readTask, saveTask } from '../workflow/state.ts';
import { receipts } from '../workflow/checks.ts';
import { fileHash } from '../workflow/readiness.ts';
import { makeScrubber } from '../digest/sanitize.ts';
import { digestFact } from '../digest/facts.ts';
import { evidenceNotes } from '../digest/notes.ts';
import { repository, workFingerprint } from '../workflow/state.ts';
import type { Run } from '../run.ts';
import { count } from '../util/profile.ts';
import { hostAgent, type HostAgent } from '../util/host.ts';
import { skillDir } from '../contribution/skillSettings.ts';
import {
  coordinatorNext,
  drafterPacket,
  resolveDrafterModel,
  DRAFTER_FILE,
  DRAFTER_PACKET,
} from '../workflow/drafter.ts';
import {
  graphEnricher,
  graphBrief,
  saveGraph,
  type GraphOutcome,
} from '../graph/evidence.ts';
import { LAYOUT_FILE, parseLayout, runLayout, saveRunLayout } from '../graph/layout.ts';
import {
  SEARCH_FILE,
  DEFAULT_GRAPH_SEARCH,
  parseGraphSearch,
  saveRunGraphSearch,
  storedGraphSearch,
} from '../graph/search.ts';
import {
  skillSettings,
  withSkillDefaults,
  type SkillSettings,
} from '../contribution/skillSettings.ts';
import {
  loadReviewPlan,
  planEnforced,
  planFromOptions,
  planSummary,
  recheckStep,
  requiredPasses,
  saveReviewPlan,
  PLAN_FILE,
  type PlanOptions,
  type ReviewPlan,
} from '../contribution/reviewPlan.ts';

export interface ScanOpts extends OutOpts {
  base?: string;
  offline?: boolean;
}

export function scanCmd(cwd: string, opts: ScanOpts): void {
  const { truth, matches } = scan(cwd, { base: opts.base, noGh: opts.offline });
  const rows = matches.map((m) => ({
    session: m.session.sessionId,
    agent: m.session.agent,
    title: m.session.title,
    score: m.score,
    band: m.band,
    reasons: m.reasons,
    keptRecords: m.kept.length,
  }));
  emit(
    opts,
    { head: truth.head, base: truth.base, commits: truth.commits.length, sessions: rows },
    () => {
      const head = `${truth.head} -> ${truth.base}: ${truth.commits.length} commit(s), ${truth.files.length} file(s)`;
      if (!rows.length) return `${head}\nNo agent sessions found for this repository.`;
      return [
        head,
        ...rows.map(
          (r) =>
            `  ${r.band.padEnd(9)} ${r.score.toFixed(2)}  ${r.agent}  ${r.title ?? r.session.slice(0, 8)}\n` +
            `            ${r.reasons.join('; ')}`,
        ),
      ].join('\n');
    },
  );
}

export interface DigestOpts extends ScanOpts {
  run?: string;
  include?: string[];
  exclude?: string[];
  budget?: number;
  /** Brief layout for this run (`prepare --layout`); kept for later commands. */
  layout?: string;
  /** Search links in the graph (`prepare --graph-search`, SKILL `Graph search:`); kept for refreshes. */
  graphSearch?: string;
}

export function digestHash(d: TraceDigest): string {
  const { generatedAt: _ignored, ...stable } = d;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 12);
}

export function digestCmd(
  cwd: string,
  opts: DigestOpts,
  shared?: ScanResult,
  display = true,
) {
  const { truth, matches } = shared ?? scan(cwd, { base: opts.base, noGh: opts.offline });
  let layout;
  let search;
  try {
    layout = parseLayout(opts.layout);
    search = parseGraphSearch(opts.graphSearch);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  const run = opts.run ? findRun(truth.gitDir, opts.run) : newRun(truth.gitDir);
  assertRunOwner(run, truth.toplevel, truth.head);
  if (layout) saveRunLayout(run, layout);
  if (search) saveRunGraphSearch(run, search);
  search ??= storedGraphSearch(run) ?? 'none';
  const config = loadConfig(truth.toplevel);
  const selected = readJson<{ include?: string[]; exclude?: string[] }>(
    run,
    'session-selection.json',
  );
  const build = {
    include: opts.include ?? selected?.include,
    exclude: opts.exclude ?? selected?.exclude,
  };
  // Both digests describe the same truth; read its provenance once.
  const interop = detectInterop(truth);
  const graph: GraphOutcome = {};
  // Check receipts first, so the evidence graph sees which checks are fresh.
  let checksReport: ReturnType<typeof checkReport> | undefined;
  let verification: ReturnType<typeof receiptEvidence> | undefined;
  // Receipts count whether or not the run was started with `task begin`.
  if (readTask(run) || receipts(run).length) {
    checksReport = checkReport(truth.toplevel, run);
    verification = receiptEvidence(truth.toplevel, run, checksReport);
  }
  const { digest, full, extractionMs, projectionMs } = buildDigestPair(truth, matches, {
    ...build,
    interop,
    budgetTokens: opts.budget ?? config.budgetTokens,
    enrich: graphEnricher(truth, graph, verification, search),
  });
  try {
    recordTiming(run, 'digest-extraction', extractionMs);
    recordTiming(run, 'digest-projection', projectionMs);
  } catch {
    // Optional telemetry must not prevent creation of the evidence packet.
  }
  if (checksReport && verification) {
    const report = checksReport;
    const validation = report.map((c) => ({
      name: c.name,
      command: c.command.join(' '),
      outcome: c.outcome,
      current: c.current,
      reason: c.reason,
      durationMs: c.durationMs,
    }));
    digest.verification = full.verification = verification;
    digest.checksSha = full.checksSha = receipts(run).length
      ? fileHash(run, 'checks.json')
      : undefined;
    const noChecks = readTask(run)?.noChecksReason;
    if (noChecks)
      validation.push({
        name: 'No local checks applicable',
        command: '',
        outcome: 'not-run',
        current: true,
        reason: makeScrubber([truth.toplevel]).text(noChecks),
        durationMs: 0,
      });
    digest.validation = full.validation = validation;
  }
  const previous = opts.run
    ? readJson<{ head: string }>(run, 'approval.json')
    : undefined;
  if (previous?.head && previous.head !== truth.head)
    throw new UserError(
      `This run belongs to branch ${previous.head}. Switch to that branch before refreshing it.`,
    );
  // Retain preparation ownership for existing run records; this never holds the session open.
  const task = readTask(run);
  if (task && task.state !== 'published') {
    // The session running the digest is the one asking; the task owner is a fallback.
    const by =
      process.env.CODEX_THREAD_ID ||
      process.env.CLAUDE_CODE_SESSION_ID ||
      process.env.CLAUDE_SESSION_ID ||
      task.session;
    if (!task.prRequestedAt || (by && task.prRequestedBy !== by)) {
      task.prRequestedAt ??= new Date().toISOString();
      if (by) task.prRequestedBy = by;
    }
    if (
      task.state === 'working' ||
      task.state === 'blocked' ||
      task.state === 'deferred'
    ) {
      if (task.state !== 'working')
        task.recoveryGeneration = (task.recoveryGeneration ?? 0) + 1;
      task.state = 'preparing';
      task.reason = undefined;
    }
    saveTask(run, task);
  }
  writeJson(run, 'session-selection.json', build);
  const path = writeJson(run, 'digest.json', digest);
  writeJson(run, 'digest-full.json', full);
  saveGraph(run, graph);
  let brief: string | undefined;
  try {
    brief = graph.graph
      ? graphBrief(graph.graph, { layout: runLayout(run), strict: true })
      : undefined;
  } catch (e) {
    // A brief that silently goes missing leaves the drafter without evidence.
    throw new UserError(
      `the evidence brief query failed for run ${run.id}: ${(e as Error).message}. Prepare stopped; report this error rather than drafting without the brief.`,
    );
  }
  writeFileSync(join(run.dir, 'evidence-notes.md'), evidenceNotes(full, brief), 'utf8');
  const captured = submissionSnapshot(truth);
  writeJson(run, 'submission.json', captured);
  const ambiguous = digest.sessions.filter((s) => s.band === 'ambiguous');
  if (display)
    emit(
      opts,
      {
        run: run.id,
        runDir: run.dir,
        digestPath: path,
        evidenceNotesPath: join(run.dir, 'evidence-notes.md'),
        sessions: digest.sessions.map((s) => ({
          ref: s.ref,
          agent: s.agent,
          title: s.title,
          band: s.band,
          score: s.score,
        })),
        ambiguous: ambiguous.map((s) => s.ref),
        stats: digest.stats,
        notes: digest.notes,
      },
      () =>
        [
          `Run ${run.id}: digest written to ${path}`,
          `${digest.sessions.length} session(s): ` +
            digest.sessions
              .map(
                (s) => `${s.ref} ${s.agent} "${s.title ?? ''}" (${s.band}, ${s.score})`,
              )
              .join('; '),
          ambiguous.length
            ? `Ambiguous, left out: ${ambiguous.map((s) => s.ref).join(', ')}. The PR message says so; re-run with --include only if one clearly belongs.`
            : '',
          ...digest.notes,
        ]
          .filter(Boolean)
          .join('\n'),
    );
  return { truth, run, digest, full, captured, graph: graph.graph, brief };
}

export function expandCmd(
  cwd: string,
  ref: string | string[],
  opts: OutOpts & { run?: string },
): void {
  const repo = repository(cwd);
  const run = findRun(repo.gitDir, opts.run);
  assertRunOwner(run, repo.root, repo.branch);
  const full = readJson<TraceDigest>(run, 'digest-full.json');
  const refs = typeof ref === 'string' ? [ref] : ref;
  count('evidence.requestedRefs', refs.length);
  if (refs.length > 1) count('evidence.batchExpansions');
  const records = refs.map((id) => {
    const evidence = full && digestFact(full, id);
    if (!evidence) throw new UserError(`No evidence ${id} in run ${run.id}.`);
    return { ref: id, evidence };
  });
  const value = records.length === 1 ? records[0]!.evidence : records;
  emit(opts, value, () => JSON.stringify(value, null, 2));
}

export function contextCmd(
  cwd: string,
  opts: OutOpts & { run?: string; offline?: boolean },
  prepared?: { truth: PrTruth; run: Run },
  display = true,
) {
  let truth = prepared?.truth ?? prTruth(cwd, { noGh: opts.offline });
  let run;
  if (prepared) run = prepared.run;
  else if (opts.run) run = findRun(truth.gitDir, opts.run);
  else {
    try {
      run = findRun(truth.gitDir);
    } catch {
      run = newRun(truth.gitDir);
    }
  }
  assertRunOwner(run, truth.toplevel, truth.head);
  const digest = readJson<TraceDigest>(run, 'digest.json');
  if (digest?.pr.base && digest.pr.base !== truth.base)
    truth = prTruth(cwd, { base: digest.pr.base, noGh: opts.offline });
  const contribution = writeResearchPacket(run, truth, opts.offline);
  const template = findPrTemplate(truth.toplevel);
  const policy = detectAiPolicy(truth.toplevel);
  const titleRules = readTitleRules(truth.toplevel, {
    offline: opts.offline,
    repo: truth.remote ? `${truth.remote.owner}/${truth.remote.name}` : undefined,
  });
  const config = loadConfig(truth.toplevel);
  // Compact creative choices help this comic differ. Skipped when comics are off.
  const recent =
    config.comic !== 'off' ? recentComics(truth, { offline: opts.offline }) : [];
  const ctx = {
    repo: truth.remote ? `${truth.remote.owner}/${truth.remote.name}` : null,
    head: truth.head,
    base: truth.base,
    template: template ?? null,
    aiPolicy: policy,
    existingPr: truth.pr
      ? {
          number: truth.pr.number,
          url: truth.pr.url,
          title: truth.pr.title,
          humanBody: humanPart(truth.pr.body),
          body: truth.pr.body,
          // Someone edited Tracetoon's section on GitHub since it was posted:
          // their text is the starting point, not something to overwrite.
          editedOnGitHub: regionEdited(truth.pr.body) ?? false,
          editedText: regionEdited(truth.pr.body)
            ? regionContent(truth.pr.body)
            : undefined,
          previous: decodeMeta(truth.pr.body) ?? null,
        }
      : null,
    config,
    comic: {
      recentStyles: recent.flatMap((c) => (c.style ? [c.style] : [])),
      recentComics: recent,
    },
    titleRules,
    contribution,
  };
  writeJson(run, 'context.json', ctx);
  if (display)
    emit(
      opts,
      {
        run: run.id,
        ...ctx,
        runDir: run.dir,
        contextPath: join(run.dir, 'context.json'),
        existingPr: ctx.existingPr && { ...ctx.existingPr, body: undefined },
      },
      () =>
        [
          `Run ${run.id}: context written`,
          `PR: ${ctx.existingPr ? `#${ctx.existingPr.number} ${ctx.existingPr.title}` : 'none yet (will create one)'}`,
          ...(ctx.existingPr?.editedOnGitHub
            ? [
                "Note: Tracetoon's section of this PR was edited on GitHub since it was posted. Start from that text (existingPr.editedText) and keep the edits.",
              ]
            : ctx.existingPr?.humanBody
              ? [
                  'Note: this PR already has a description written by someone. Keep it; add to it rather than replacing it.',
                ]
              : []),
          `Template: ${template ? template.path : 'none'}`,
          `Contribution research: ${contribution.sourceSeeds.length} source seed(s); guidance-request.json and changes.patch written${contribution.offline ? ' (offline: do not browse external links)' : ''}.`,
          `AI policy: ${policy.verdict}${policy.excerpts.length ? ` (${policy.excerpts.length} mention(s))` : ''}`,
          ...policy.excerpts.slice(0, 5).map((e) => `  ${e.file}:${e.line}: ${e.text}`),
          `prompt quoting: ${config.promptQuoting} | comic: ${config.comic}`,
          ...describeTitleRules(titleRules),
          config.comic === 'off'
            ? ''
            : config.style && config.style !== 'auto'
              ? `Comic style: pinned to ${config.style}`
              : `Comic: choose the story, composition and cast; compare recent creative choices (${
                  recent
                    .map((c) => c.style)
                    .filter(Boolean)
                    .join('; ') || 'none yet'
                })`,
        ]
          .filter(Boolean)
          .join('\n'),
    );
  return { run, context: ctx };
}

/** One immutable preparation snapshot shared by digest and contributor research. */
/**
 * The first drafting step, printed where every drafter looks: agents that
 * write the description themselves often go from `prepare` straight to the
 * body, past the skill's drafter instructions.
 */
/**
 * The drafting rules a writer needs, in prepare's next step, so it need not
 * read references/drafting.md again (that file holds the reasons and examples).
 */
export const DRAFTING_RULES =
  'Drafting rules (references/drafting.md has the detail): lead with the problem and why, stated as the PR\'s purpose (quote the request; never "a later request in the session"), then the design, then its consequences; no file-by-file inventory; 250–450 words, no fixed section list. When a change row has `was` or `before`, say what the code did in one "Previously …" sentence. Give each behavior its guarding condition (from `behavior`); "always", "only", "every" only when every branch does it. State each open `limits` row that matters and that you can back, in its own scope with its tag ("the recorded tests fake the network"); skip a row you can\'t support; never "untested" or "nothing ran". Render writes only a stale session run and a failed push under Validation: don\'t restate those. At most one sentence on CI/push status; housekeeping (version bumps, lockfiles, rebuilt bundles) at most one clause; a claim from a commit message or code comment is attributed or dropped unless the diff shows it. End with a "Where to start" line (the `entry` row\'s function and file, with only the behaviors it owns) and a "Feedback wanted" line (one concrete question for reviewers). Describe the goal as the PR\'s purpose, never as session history; never use brief vocabulary ("the brief", "limits row") in the body. Tag each factual sentence with brief refs ([CH1, commit:<sha>#2], [L1], [T1]) and put `<!-- tracetoon:validation -->` where the Validation section belongs; never write run results yourself.';

/**
 * How prepare's next step is addressed: to the agent that drafts itself
 * (default), or to a fresh delegated drafter (`drafter`, written to
 * drafter-packet.md). A Claude Code drafter can't start reviewer agents, so it
 * stops when the packets are ready and the coordinator starts them.
 */
export interface NextRole {
  role: 'drafter';
  host: HostAgent;
}

export function graphNext(run: string, plan?: ReviewPlan, as?: NextRole): string {
  const enforced = planEnforced(plan);
  const settings = enforced
    ? `${plan.reviewerModel ? ` on model ${plan.reviewerModel}` : ''}${plan.reviewerEffort ? ` at effort ${plan.reviewerEffort}` : ''}`
    : '';
  const flags = enforced
    ? `${plan.reviewerModel ? ` --reviewer-model ${plan.reviewerModel}` : ''}${plan.reviewerEffort ? ` --reviewer-effort ${plan.reviewerEffort}` : ''}`
    : '';
  const tracetoonReview = enforced && plan.runner === 'tracetoon' && !!plan.reviewerModel;
  const n = enforced ? requiredPasses(plan) : 1;
  const onePass = `apply it in ONE edit pass of body.md (check each finding against the lines it cites; fix or reject every flagged claim), \`tracetoon finish --run ${run}\` again, then ${recheckStep(run, plan)}`;
  const handBack =
    as && !tracetoonReview
      ? `finish writes the review packets; you can't start agents, so stop there and reply exactly \`PACKETS READY\` (nothing else). The coordinator starts the fresh reviewers and messages you each reviewer's agent id and lens; then import each with \`tracetoon review import --run ${run} [--lens <lens>] --agent-id <its id>${flags}\` (a general reviewer: no --lens, and \`--findings <its file>\` when it isn't review-findings.json), \`tracetoon review merge --run ${run}\` and ${onePass}`
      : undefined;
  const review = handBack
    ? handBack
    : tracetoonReview
    ? `\`tracetoon review run --all --run ${run}\` (Tracetoon runs ${n === 1 ? 'the reviewer' : `all ${n} reviewer passes${plan.lenses.length ? ` (lenses ${plan.lenses.join(', ')}${n > plan.lenses.length ? ' plus general' : ''})` : ''} in parallel`} on ${plan.reviewerModel}, imports each and writes one merged list, review-findings-merged.md; don't start a reviewer agent; ${BLOCKING_RULE}); ${onePass}`
    : !enforced
      ? `finish writes review-packet.md (\`tracetoon review-packet --lean --run ${run}\`); one fresh independent reviewer (not a fork) gets review-packet.md plus references/reviewer-lean.md and writes review-findings.json; \`tracetoon review import --run ${run} --agent-id <its id>\`; one correction round, then ${recheckStep(run, plan)}`
      : plan.lenses.length
        ? `finish writes one packet per lens ${plan.lenses.join(', ')} (\`tracetoon review-packet --lean --lens <lens> --run ${run}\`)${requiredPasses(plan) > plan.lenses.length ? ' and review-packet.md' : ''}; start one fresh reviewer per lens${requiredPasses(plan) > plan.lenses.length ? ` and ${requiredPasses(plan) - plan.lenses.length} general reviewer(s) (review-packet.md)` : ''} IN PARALLEL (all in one message; Claude Code: foreground Agent calls, never run_in_background, and don't end the turn until they return)${settings} (packet plus references/reviewer-lens-<lens>.md); import each with \`tracetoon review import --run ${run} --lens <lens> --agent-id <its id>${flags}\`; then \`tracetoon review merge --run ${run}\` and ${onePass}`
        : `finish writes review-packet.md (\`tracetoon review-packet --lean --run ${run}\`); ${requiredPasses(plan)} fresh reviewer pass(es), each a NEW reviewer${settings} (packet plus references/reviewer-lean.md)${requiredPasses(plan) > 1 ? ', all started in one message' : ''}; import each with \`tracetoon review import --run ${run} --agent-id <its id>${flags}\`; then \`tracetoon review merge --run ${run}\` and ${onePass}`;
  const opening = as
    ? `You draft title.txt and body.md in the run folder from the evidence brief (at the end of this packet; \`tracetoon query brief --run ${run}\` prints it again) and the patch.`
    : `take the reviewed brief path (SKILL step 2b): draft title.txt and body.md yourself from the evidence brief (\`tracetoon query brief --run ${run}\`) and the patch.`;
  const closing = as
    ? `when finish says \`tracetoon publish --run ${run}\`, stop and reply exactly \`READY TO PUBLISH\` followed by the title; never run publish yourself: the coordinator publishes. Never end your turn earlier${handBack ? ', except at PACKETS READY' : ''}, and never wait on optional things (CI, a long rerun).`
    : `publish (\`tracetoon publish --run ${run}\`) when finish says so the review is current${enforced ? ` (publish refuses until the review plan is met: ${planSummary(plan)})` : ''}. Always render, review and publish before ending the turn and before any optional waiting (CI, a long rerun). Only on the user's request: the quick path (SKILL step 2a) or the three-role thorough path.`;
  return `${opening} ${DRAFTING_RULES} Run each of the repository's required checks once, in the FOREGROUND, each as its own \`tracetoon check --run ${run} --name <check> -- <program> <args>\` (it blocks until done, stops after 15 min and prints a short summary with the path of the full log; a timeout is "timed out (incomplete)", never a failure: don't rerun it. Never start it in the background, poll it (sleep/until loops) or end your turn while it runs; on Claude Code give the Bash call \`timeout: 600000\`, and if a check is moved to the background anyway, run the same command again in the foreground: it waits for the running one. One command per check, never chained in \`bash -c '… && …'\`; record a check that can't run here with \`--skip "<reason>"\`. ${BLOCKING_RULE}) ${QUICK_RULE} Then \`tracetoon finish --run ${run}\`: it renders, runs the brief check (fix what it lists and run finish again, up to three rounds), writes the review packets and prints the one next step; then ${review}; ${closing}`;
}

export function prepareCmd(cwd: string, given: DigestOpts & PlanOptions) {
  const repo = repository(cwd);
  const before = workFingerprint(repo.root);
  const shared = scan(cwd, { base: given.base, noGh: given.offline });
  // Unset options default to the skill's own variant lines, so a configured
  // reviewer plan or brief layout holds even when the agent doesn't pass it.
  // A run that already stored a layout or plan keeps it.
  const skill = skillSettings();
  const existing = (() => {
    if (!given.run) return undefined;
    try {
      return findRun(shared.truth.gitDir, given.run);
    } catch {
      return undefined;
    }
  })();
  if (existing && existsSync(join(existing.dir, LAYOUT_FILE))) delete skill.layout;
  if (existing && existsSync(join(existing.dir, SEARCH_FILE))) delete skill.graphSearch;
  if (existing && existsSync(join(existing.dir, PLAN_FILE))) {
    delete skill.reviewerModel;
    delete skill.reviewerEffort;
    delete skill.reviewPasses;
    delete skill.reviewLenses;
    delete skill.reviewerRunner;
    delete skill.reviewRecheck;
  }
  const opts = withSkillDefaults(
    given as DigestOpts & PlanOptions & SkillSettings,
    skill,
  );
  // Without a flag, a SKILL line or a stored mode, prepare searches.
  if (!opts.graphSearch && !(existing && existsSync(join(existing.dir, SEARCH_FILE))))
    opts.graphSearch = DEFAULT_GRAPH_SEARCH;
  let plan: ReviewPlan | undefined;
  try {
    plan = planFromOptions(opts);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  const prepared = digestCmd(cwd, opts, shared, false);
  const context = contextCmd(cwd, { ...opts, run: prepared.run.id }, prepared, false);
  if (plan) saveReviewPlan(prepared.run, plan);
  else plan = loadReviewPlan(prepared.run);
  if (workFingerprint(repo.root) !== before)
    throw new UserError(
      'Repository changed during preparation. Retained outputs are stale; prepare again after finalizing the changes.',
    );
  const roles = {
    schema: 'tracetoon.role-packets/v1',
    run: prepared.run.id,
    snapshot: {
      headBranch: shared.truth.head,
      headSha: prepared.captured.headSha,
      diffSha256: prepared.captured.diffSha256,
      mergeBase: shared.truth.mergeBase,
      digest: digestHash(prepared.full),
      sourceFingerprint: before,
    },
    researcher: ['guidance-request.json', 'context.json', 'changes.patch'],
    drafter: [
      'digest.json',
      'evidence-notes.md',
      'changes.patch',
      'context.json',
      'guidance.json',
      'author.md',
    ],
    reviewerColdRead: ['title.txt', 'final-body.md'],
    reviewerEvidence: [
      'review-input.json',
      'changes.patch',
      'source-evidence.json',
      'guidance.json',
      'digest.json',
      'evidence-notes.md',
      'change-map.json',
    ],
    graph: prepared.graph
      ? {
          path: 'evidence-graph.json',
          stats: prepared.graph.stats,
          drafter: ['brief', 'why <path>', 'turn <S#>', 'unverified'],
          reviewer: ['unverified', 'unexplained', 'why <path|H#>', 'stale <R#>'],
        }
      : null,
    instructions:
      'Use fresh role contexts where supported. Read the cold-read packet before the reviewer evidence. Expand referenced evidence in batches; missing evidence remains unknown. Drafter and reviewer: ask the evidence graph with `tracetoon query <name> --run <id>` (start with `brief`) before reading the whole patch; its diff refs are citable as change-map behaviorChecks evidence.',
  };
  writeJson(prepared.run, 'role-packets.json', roles);
  // Delegated drafting: the drafter gets the self-drafter's next step and the
  // brief in drafter-packet.md; this agent gets only the coordinator steps.
  const host = hostAgent() ?? null;
  const drafterModel =
    prepared.graph && prepared.brief && host
      ? resolveDrafterModel((opts as { drafterModel?: unknown }).drafterModel, host)
      : undefined;
  let next = prepared.graph ? graphNext(prepared.run.id, plan) : undefined;
  let drafterPath: string | undefined;
  if (drafterModel && host) {
    const dir = skillDir() ?? '';
    const paths = {
      run: prepared.run.id,
      runDir: prepared.run.dir,
      repoRoot: repo.root,
      launcher: join(dir, 'bin', process.platform === 'win32' ? 'tracetoon.cmd' : 'tracetoon'),
      skillDir: dir,
    };
    drafterPath = join(prepared.run.dir, DRAFTER_PACKET);
    writeFileSync(
      drafterPath,
      drafterPacket(paths, graphNext(prepared.run.id, plan, { role: 'drafter', host }), prepared.brief!),
      'utf8',
    );
    writeJson(prepared.run, DRAFTER_FILE, { v: 1, host, model: drafterModel });
    next = coordinatorNext(
      paths,
      host,
      drafterModel,
      plan,
      planEnforced(plan) && plan.runner === 'tracetoon' && !!plan.reviewerModel,
    );
  }
  emit(
    opts,
    {
      run: prepared.run.id,
      ...(next ? { next } : {}),
      // One JSON line, so piping through `head` still shows the whole map.
      ...(prepared.brief && !drafterPath ? { brief: prepared.brief } : {}),
      ...(drafterPath ? { drafter: { model: drafterModel, packet: drafterPath } } : {}),
      ...(planEnforced(plan) ? { reviewPlan: plan } : {}),
      runDir: prepared.run.dir,
      rolePackets: join(prepared.run.dir, 'role-packets.json'),
      digestPath: join(prepared.run.dir, 'digest.json'),
      contextPath: join(prepared.run.dir, 'context.json'),
      ...context.context.contribution,
    },
    () =>
      [
        `Run ${prepared.run.id}: digest, context and role-packets.json prepared from one snapshot.`,
        next ? `Next: ${next}` : '',
        prepared.brief && !drafterPath ? `Evidence brief:\n${prepared.brief}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
  );
  return prepared;
}

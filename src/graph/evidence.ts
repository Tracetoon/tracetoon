/**
 * Builds a run's evidence graph alongside its digest. Fails open: when the graph
 * engine cannot start, the digest is still written (with the trimming rules it
 * had before the graph) and says what is missing.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { submission } from '../contribution/guidance.ts';
import type { Relevance, SessionTrail, TraceDigest } from '../digest/build.ts';
import type { PrTruth } from '../git/pr.ts';
import { git } from '../util/exec.ts';
import { readJson, writeJson, type Run } from '../run.ts';
import { measured } from '../util/profile.ts';
import { evidenceLine } from '../correlate/correlate.ts';
import type { Run as DigestRun } from '../digest/build.ts';
import { buildEvidenceGraph } from './build.ts';
import { addHeadScan } from './headScan.ts';
import { addBaseContext } from './baseContext.ts';
import { addCiCallers, addWorkflowJobs } from './workflowJobs.ts';
import { addSearchLinks, type GraphSearch } from './search.ts';
import { annotateDigest, deriveFromGraphJson, type GraphDerived } from './derive.ts';
import type { EvidenceGraph } from './model.ts';
import { withGraph } from './engine.ts';
import { brief, briefParts } from './queries.ts';
import type { BriefParts } from './briefRender.ts';
import { toToon } from './toon.ts';
import { renderNeighborhood } from './neighborhood.ts';
import { briefBudget, isNeighborhood, type BriefLayout } from './layout.ts';

export const GRAPH_FILE = 'evidence-graph.json';
export const GRAPH_REVIEW_FILE = 'graph-review.json';

export interface GraphOutcome {
  graph?: EvidenceGraph;
  derived?: GraphDerived;
  error?: string;
}

/** Which PR files each commit touched: one `git log` for the whole range. */
export function commitFiles(truth: PrTruth): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (truth.usedWorkingTree || !truth.commits.length) return out;
  const head = truth.headSha ?? truth.commits.at(-1)!.sha;
  const r = git(truth.toplevel, [
    'log',
    '--no-merges',
    '--no-renames',
    '--format=%x1e%H',
    '--name-only',
    `${truth.mergeBase}..${head}`,
  ]);
  if (!r.ok) return out;
  for (const rec of r.stdout.split('\x1e')) {
    const [sha, ...paths] = rec.trim().split(/\r?\n/);
    if (sha) out.set(sha.trim(), paths.map((p) => p.trim()).filter(Boolean));
  }
  return out;
}

/** Each commit's own added lines per file (normalized), from one `git log -p`. */
export function commitLines(truth: PrTruth): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  if (truth.usedWorkingTree || !truth.commits.length) return out;
  const head = truth.headSha ?? truth.commits.at(-1)!.sha;
  const r = git(truth.toplevel, [
    'log',
    '--no-merges',
    '--no-renames',
    '--no-color',
    '-p',
    '-U0',
    '--format=%x1e%H',
    `${truth.mergeBase}..${head}`,
  ]);
  if (!r.ok) return out;
  for (const rec of r.stdout.split('\x1e')) {
    const lines = rec.split(/\r?\n/);
    const sha = lines[0]?.trim();
    if (!sha) continue;
    const files = new Map<string, string[]>();
    let file: string | undefined;
    for (const line of lines.slice(1)) {
      if (line.startsWith('+++ ')) {
        const p = line.slice(4).trim();
        // A deleted file keeps the path from its "--- a/…" line.
        if (p !== '/dev/null') file = p.replace(/^b\//, '');
        continue;
      }
      if (line.startsWith('diff --git ')) {
        file = undefined;
        continue;
      }
      if (line.startsWith('--- ')) {
        const p = line.slice(4).trim();
        if (p !== '/dev/null') file = p.replace(/^a\//, '');
        continue;
      }
      if (file && (line.startsWith('+') || line.startsWith('-'))) {
        const e = evidenceLine(line.slice(1));
        if (e)
          files.set(file, [...(files.get(file) ?? []), line[0] === '-' ? `-${e}` : e]);
      }
    }
    out.set(sha, files);
  }
  return out;
}

/**
 * Files the patch adds whose content is byte-identical to a file already in
 * the merge base (same blob): added path → the base path it copies. A copy is
 * not new content, however many lines it adds.
 */
export function copiedFiles(truth: PrTruth, patch: string): Map<string, string> {
  const out = new Map<string, string>();
  const added: { path: string; blob: string }[] = [];
  for (const block of patch.split(/^(?=diff --git )/m)) {
    if (!/^new file mode /m.test(block)) continue;
    const blob = /^index 0+\.\.([0-9a-f]{7,64})\b/m.exec(block)?.[1];
    const path = /^\+\+\+ b\/(.+)$/m.exec(block)?.[1]?.trim();
    if (blob && path && !/^0+$/.test(blob)) added.push({ path, blob });
  }
  if (!added.length || !truth.mergeBase) return out;
  const r = git(truth.toplevel, ['ls-tree', '-r', '--full-tree', truth.mergeBase]);
  if (!r.ok) return out;
  const byBlob = new Map<string, string>();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m && !byBlob.has(m[1]!)) byBlob.set(m[1]!, m[2]!);
  }
  for (const a of added) {
    for (const [blob, path] of byBlob)
      if (blob.startsWith(a.blob) && path !== a.path) {
        out.set(a.path, path);
        break;
      }
  }
  return out;
}

/** The `enrich` hook for buildDigestPair: build, derive, annotate. */
export function graphEnricher(
  truth: PrTruth,
  out: GraphOutcome,
  /** Exact-content check receipts, so the graph can tell fresh checks from logged ones. */
  verification?: DigestRun[],
  /** Search links (TIED_TO) to add: `prepare`'s Graph search; none when omitted. */
  search: GraphSearch = 'none',
): (full: TraceDigest, trails: SessionTrail[]) => Relevance | undefined {
  return (full, trails) => {
    try {
      if (verification) full.verification = verification;
      const patch = submission(truth).patch;
      const graph = measured('graph.build', () =>
        buildEvidenceGraph({
          full,
          trails,
          patch,
          commitFiles: commitFiles(truth),
          commitLines: commitLines(truth),
        }),
      );
      // Added files that copy a base file byte for byte.
      try {
        const copies = copiedFiles(truth, patch);
        for (const n of graph.nodes)
          if (n.label === 'File' && copies.has(n.id)) n.props.copyOf = copies.get(n.id)!;
      } catch {
        // No copy marks; the graph is otherwise whole.
      }
      // What adding-only hunks' functions did at the base (`before`).
      try {
        measured('graph.baseContext', () =>
          addBaseContext(graph, truth.toplevel, truth.mergeBase, patch),
        );
      } catch {
        // No `before` lines; the graph is otherwise whole.
      }
      // Changed CI workflows, job by job (added/removed/changed, runner, needs, if, shipping steps).
      try {
        measured('graph.workflowJobs', () =>
          addWorkflowJobs(
            graph,
            truth.toplevel,
            truth.mergeBase,
            truth.usedWorkingTree
              ? undefined
              : (truth.headSha ?? truth.commits.at(-1)?.sha),
          ),
        );
      } catch {
        // No job summaries; the graph is otherwise whole.
      }
      // Changed files a workflow at the head runs (a script CI calls).
      try {
        measured('graph.ciCallers', () =>
          addCiCallers(
            graph,
            truth.toplevel,
            truth.usedWorkingTree
              ? undefined
              : (truth.headSha ?? truth.commits.at(-1)?.sha),
          ),
        );
      } catch {
        // No CI callers; the graph is otherwise whole.
      }
      // Key lines per hunk, and search links from commit text, requests and plans.
      measured('graph.search', () =>
        addSearchLinks({
          graph,
          patch,
          mode: search,
          prompts: full.sessions.flatMap((s) =>
            s.prompts.flatMap((p) => (p.id ? [{ id: p.id, text: p.text }] : [])),
          ),
          plans: full.sessions.flatMap((s) =>
            s.plans.flatMap((p) => (p.id ? [{ id: p.id, text: p.excerpt }] : [])),
          ),
        }),
      );
      // What the head tree still says about removed names, and who calls the changed ones.
      measured('graph.headScan', () =>
        addHeadScan(
          graph,
          truth.toplevel,
          truth.usedWorkingTree
            ? undefined
            : (truth.headSha ?? truth.commits.at(-1)?.sha),
        ),
      );
      const derived = measured('graph.derive', () => deriveFromGraphJson(graph));
      annotateDigest(full, derived);
      full.graph = graph.stats;
      out.graph = graph;
      out.derived = derived;
      return derived.relevance;
    } catch (e) {
      out.error = (e as Error).message;
      full.notes.push(
        `Evidence graph unavailable (${out.error}); per-file provenance and \`tracetoon query\` are missing from this run.`,
      );
      return undefined;
    }
  };
}

export function saveGraph(run: Run, outcome: GraphOutcome): void {
  for (const f of [GRAPH_FILE, GRAPH_REVIEW_FILE])
    if (existsSync(join(run.dir, f))) unlinkSync(join(run.dir, f));
  if (!outcome.graph || !outcome.derived) return;
  writeJson(run, GRAPH_FILE, outcome.graph);
  writeJson(run, GRAPH_REVIEW_FILE, outcome.derived.review);
}

export function loadGraph(run: Run): EvidenceGraph | undefined {
  return readJson<EvidenceGraph>(run, GRAPH_FILE);
}

export function loadGraphReview(run: Run): GraphDerived['review'] | undefined {
  return readJson<GraphDerived['review']>(run, GRAPH_REVIEW_FILE);
}

/**
 * The `query brief` result as text, for places every drafter reads before
 * writing (the `prepare` output, the top of evidence-notes.md). Agents that
 * draft inline often skip running queries, so they get it anyway.
 * Undefined when the graph can't be read; the digest never depends on it.
 */
/** The brief as data, for `render` to write the Validation section and check ref tags. */
export function graphBriefParts(
  graph: EvidenceGraph,
  layout: BriefLayout = 'toon',
  /** A check receipt passed on the submitted content (checks.ts `passOnSubmittedContent`). */
  freshPass = false,
): (BriefParts & { hunkLinks: Record<string, string[]> }) | undefined {
  try {
    return withGraph(graph, (g) => briefParts(g, { layout, freshPass }));
  } catch {
    return undefined;
  }
}

export function graphBrief(
  graph: EvidenceGraph,
  opts: {
    rowCap?: number;
    layout?: BriefLayout;
    freshPass?: boolean;
    /** Rethrow a failing brief query instead of returning undefined. */
    strict?: boolean;
  } = {},
): string | undefined {
  const rowCap = opts.rowCap ?? 60;
  try {
    if (isNeighborhood(opts.layout))
      return withGraph(graph, (g) => {
        const { sections } = briefParts(g, {
          layout: 'neighborhood',
          freshPass: opts.freshPass,
        });
        const budget = briefBudget(opts.layout);
        // As long as the TOON brief of the same run, so the layouts compare at equal size.
        const targetChars = budget.matchToon
          ? toToon(
              sections.filter((s) => s.title !== 'hunks'),
              { rowCap },
            ).trimEnd().length
          : undefined;
        return renderNeighborhood(sections, { budgetTokens: budget.tokens, targetChars });
      }).trimEnd();
    const sections = withGraph(graph, (g) => brief(g, { freshPass: opts.freshPass }));
    return toToon(sections, { rowCap }).trimEnd();
  } catch (e) {
    if (opts.strict) throw e;
    return undefined;
  }
}

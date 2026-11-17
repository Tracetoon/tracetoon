/**
 * What a changed CI workflow does differently, job by job: the jobs added,
 * removed or changed between the base and the head file, each with its
 * runner (`runs-on`), what it waits for (`needs`), when it runs (`if:`) and
 * its artifact, signing, publishing and release steps. A workflow diff's
 * first changed line rarely says this; writers retold one step as the whole
 * change. Kept as `jobs` on the workflow's File node.
 *
 * A small indentation reader, not a YAML parser: anchors, flow mappings and
 * multi-document files are read as far as their lines show. Fails open.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../util/exec.ts';
import type { EvidenceGraph } from './model.ts';

export const WORKFLOW_PATH =
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)azure-pipelines\.ya?ml$/;

export interface WorkflowStep {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
}
export interface WorkflowJob {
  /** A reusable workflow the job calls (`uses: ./.github/workflows/x.yml`). */
  uses?: string;
  runsOn?: string;
  needs?: string;
  if?: string;
  environment?: string;
  steps: WorkflowStep[];
}
export interface Workflow {
  on?: string;
  jobs: Map<string, WorkflowJob>;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const unquote = (s: string) =>
  s
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
const meaningful = (l: string) => l.trim() !== '' && !l.trim().startsWith('#');

/** The lines of a block under `lines[i]` (more indented than it). */
function blockAt(lines: string[], i: number): string[] {
  const base = indentOf(lines[i]!);
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (meaningful(l) && indentOf(l) <= base) break;
    out.push(l);
  }
  return out;
}

/** A key's value at the block's own indent: inline, or a list / block below it, flattened. */
function valueOf(block: string[], key: string): string | undefined {
  const first = block.find(meaningful);
  if (!first) return undefined;
  const ind = indentOf(first);
  for (let i = 0; i < block.length; i++) {
    const l = block[i]!;
    if (!meaningful(l) || indentOf(l) !== ind) continue;
    const m = new RegExp(`^\\s*${key}:\\s*(.*)$`).exec(l);
    if (!m) continue;
    const inline = unquote(m[1]!);
    if (inline && !/^[|>][-+]?$/.test(inline))
      return inline.replace(/^\[(.*)\]$/, '$1').replace(/\s*,\s*/g, ', ');
    const below = blockAt(block, i)
      .filter(meaningful)
      .map((x) => unquote(x.trim().replace(/^-\s*/, '')));
    return below.length ? below.join(', ') : undefined;
  }
  return undefined;
}

/** A workflow's triggers and jobs, from its text. */
export function parseWorkflow(text: string): Workflow {
  const lines = text.split(/\r?\n/);
  const jobs = new Map<string, WorkflowJob>();
  let on: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (indentOf(l) !== 0) continue;
    const top = /^(['"]?)(on|jobs)\1:\s*(.*)$/.exec(l);
    if (!top) continue;
    if (top[2] === 'on') {
      const inline = unquote(top[3]!);
      on = inline
        ? inline.replace(/^\[(.*)\]$/, '$1')
        : (() => {
            const block = blockAt(lines, i).filter(meaningful);
            const ind = block[0] ? indentOf(block[0]) : 0;
            return block
              .filter((x) => indentOf(x) === ind)
              .map((x) => x.trim().replace(/^-\s*/, '').replace(/:.*$/, ''))
              .join(', ');
          })();
      continue;
    }
    const block = blockAt(lines, i);
    const first = block.find(meaningful);
    if (!first) continue;
    const ind = indentOf(first);
    for (let j = 0; j < block.length; j++) {
      const k = block[j]!;
      if (!meaningful(k) || indentOf(k) !== ind) continue;
      const name = /^\s*([\w.-]+):\s*$/.exec(k)?.[1];
      if (!name) continue;
      const body = blockAt(block, j);
      const job: WorkflowJob = { steps: [] };
      job.uses = valueOf(body, 'uses');
      job.runsOn = valueOf(body, 'runs-on');
      job.needs = valueOf(body, 'needs');
      job.if = valueOf(body, 'if');
      job.environment = valueOf(body, 'environment');
      // A matrix runner: the runner labels the job's lines name.
      if (job.runsOn && /\$\{\{/.test(job.runsOn)) {
        const labels = [
          ...new Set(body.join('\n').match(/\b(?:windows|macos|ubuntu)-[\w.-]+/g) ?? []),
        ];
        if (labels.length) job.runsOn = `${job.runsOn} (${labels.join(', ')})`;
      }
      const stepsAt = body.findIndex(
        (x) =>
          meaningful(x) &&
          indentOf(x) === indentOf(body.find(meaningful) ?? '') &&
          /^\s*steps:\s*$/.test(x),
      );
      if (stepsAt >= 0) {
        const steps = blockAt(body, stepsAt);
        let cur: WorkflowStep | undefined;
        let stepInd = -1;
        for (const s of steps) {
          if (!meaningful(s)) continue;
          const dash = /^(\s*)-\s+(.*)$/.exec(s);
          if (dash && (stepInd < 0 || dash[1]!.length === stepInd)) {
            stepInd = dash[1]!.length;
            cur = {};
            job.steps.push(cur);
          }
          if (!cur) continue;
          const kv = /^\s*(?:-\s+)?(name|uses|if|run):\s*(.*)$/.exec(s);
          if (kv && !(kv[1]! in cur)) {
            const v = unquote(kv[2]!);
            if (v && !/^[|>][-+]?$/.test(v)) cur[kv[1] as keyof WorkflowStep] = v;
          }
        }
      }
      jobs.set(name, job);
    }
  }
  return { on, jobs };
}

/** A step that moves or ships what was built: artifacts, signing, publishing, releases. */
const SHIPPING =
  /artifact|\bsign|signpath|codesign|notari[sz]|attest|publish|release|upload|deploy|\bpush\b|gh release|npm publish|twine|docker push/i;

const stepLabel = (s: WorkflowStep) => {
  const what =
    s.name ??
    s.uses?.replace(/@.*$/, '') ??
    (s.run ? s.run.split('\n')[0]!.slice(0, 60) : '');
  const uses = s.name && s.uses ? ` (${s.uses.replace(/@.*$/, '')})` : '';
  return `${what}${uses}${s.if ? ` [if ${s.if}]` : ''}`;
};
const shipping = (s: WorkflowStep) =>
  SHIPPING.test(`${s.name ?? ''} ${s.uses ?? ''} ${s.run ?? ''}`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function jobFacts(j: WorkflowJob): string[] {
  return [
    j.uses ? `calls ${j.uses}` : '',
    j.runsOn ? `runs-on ${j.runsOn}` : '',
    j.needs ? `needs ${j.needs}` : '',
    j.if ? `if ${j.if}` : '',
    j.environment ? `environment ${j.environment}` : '',
  ].filter(Boolean);
}

/**
 * Lines that say what changed between two versions of a workflow (base
 * undefined for a new file): triggers, then each job added, removed or
 * changed, with its runner, needs, condition and shipping steps.
 */
export function workflowChanges(
  base: string | undefined,
  head: string | undefined,
): string[] {
  const a = base
    ? parseWorkflow(base)
    : { on: undefined, jobs: new Map<string, WorkflowJob>() };
  const b = head
    ? parseWorkflow(head)
    : { on: undefined, jobs: new Map<string, WorkflowJob>() };
  const out: string[] = [];
  if ((a.on ?? '') !== (b.on ?? '') && (base || b.on))
    out.push(
      base ? `triggers: ${a.on || 'none'} → ${b.on || 'none'}` : `triggers: ${b.on}`,
    );
  for (const [name, j] of b.jobs) {
    const old = a.jobs.get(name);
    const ships = j.steps.filter(shipping).map(stepLabel);
    if (!old) {
      out.push(
        clip(
          `job ${name} added: ${[
            ...jobFacts(j),
            ships.length
              ? `steps: ${ships.join(', ')}`
              : j.steps.length
                ? `${j.steps.length} steps`
                : '',
          ]
            .filter(Boolean)
            .join('; ')}`,
          260,
        ),
      );
      continue;
    }
    const diffs: string[] = [];
    const field = (label: string, x?: string, y?: string) => {
      if ((x ?? '') !== (y ?? '')) diffs.push(`${label} ${x || 'none'} → ${y || 'none'}`);
    };
    field('calls', old.uses, j.uses);
    field('runs-on', old.runsOn, j.runsOn);
    field('needs', old.needs, j.needs);
    field('if', old.if, j.if);
    field('environment', old.environment, j.environment);
    // A step is the same step with another action version (`@v4` → `@<sha>`).
    const key = (s: WorkflowStep) =>
      stepLabel({ ...s, uses: s.uses?.replace(/@.*$/, '') });
    const was = new Set(old.steps.map(key));
    const now = new Set(j.steps.map(key));
    const addedSteps = j.steps.filter((s) => !was.has(key(s)));
    const removedSteps = old.steps.filter((s) => !now.has(key(s)));
    const pinned = j.steps.filter((s) =>
      old.steps.some((o) => key(o) === key(s) && (o.uses ?? '') !== (s.uses ?? '')),
    ).length;
    const addShip = addedSteps.filter(shipping).map(stepLabel);
    const remShip = removedSteps.filter(shipping).map(stepLabel);
    if (addShip.length) diffs.push(`steps added: ${addShip.join(', ')}`);
    else if (addedSteps.length)
      diffs.push(`${addedSteps.length} step${addedSteps.length > 1 ? 's' : ''} added`);
    if (remShip.length) diffs.push(`steps removed: ${remShip.join(', ')}`);
    else if (removedSteps.length)
      diffs.push(
        `${removedSteps.length} step${removedSteps.length > 1 ? 's' : ''} removed`,
      );
    if (pinned) diffs.push(`${pinned} action version${pinned > 1 ? 's' : ''} changed`);
    if (diffs.length) out.push(clip(`job ${name} changed: ${diffs.join('; ')}`, 260));
  }
  for (const [name, j] of a.jobs)
    if (!b.jobs.has(name)) {
      const ships = j.steps.filter(shipping).map(stepLabel);
      out.push(
        clip(
          `job ${name} removed${ships.length ? ` (it ran: ${ships.join(', ')})` : ''}`,
          200,
        ),
      );
    }
  return out;
}

const MAX_JOB_LINES = 8;

/**
 * Sets `jobs` on each changed workflow File node, from the base and head
 * versions (`head` undefined: the working tree).
 */
export function addWorkflowJobs(
  graph: EvidenceGraph,
  toplevel: string,
  mergeBase: string | undefined,
  head: string | undefined,
): void {
  for (const n of graph.nodes) {
    if (n.label !== 'File' || n.props.inPr !== true || !WORKFLOW_PATH.test(n.id))
      continue;
    const show = (rev: string) => {
      const r = git(toplevel, ['show', `${rev}:${n.id}`]);
      return r.ok ? r.stdout : undefined;
    };
    const base = mergeBase ? show(mergeBase) : undefined;
    let now: string | undefined;
    if (head) now = show(head);
    else
      try {
        now = readFileSync(join(toplevel, n.id), 'utf8');
      } catch {
        now = undefined;
      }
    const lines = workflowChanges(base, now);
    if (lines.length) n.props.jobs = lines.slice(0, MAX_JOB_LINES);
  }
}

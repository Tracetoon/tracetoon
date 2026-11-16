/**
 * Fold verification results into compat/verification.json, and keep one
 * GitHub issue per integration in step with them.
 *
 *   bun scripts/compat/publish.ts --results <dir> [--detected '<json>'] [--issues]
 *
 * <dir> holds the result.json files the verify jobs uploaded. --detected is
 * discover.ts's `detected` map, so a release with no finished run shows as
 * pending. With --issues (and gh signed in), a failed run opens or updates the
 * integration's `compat:<id>` issue, a blocked run updates a `compat-blocked`
 * issue, and a pass closes any open failure issue for that integration.
 *
 * Prints a Markdown summary for the workflow's step summary.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  VERIFICATION_FILE,
  readVerification,
  type VerificationFile,
  type VerificationRun,
} from './records.ts';
import { INTEGRATIONS } from '../../src/integrations/registry.ts';

function resultFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return resultFiles(p);
    return name.endsWith('.json') ? [p] : [];
  });
}

/** Results that look like runs; anything else in the folder is ignored. */
function readRuns(dir: string): VerificationRun[] {
  const runs: VerificationRun[] = [];
  for (const f of resultFiles(dir)) {
    try {
      const r = JSON.parse(readFileSync(f, 'utf8'));
      if (r?.target && r?.upstreamVersion && r?.status && r?.os) runs.push(r);
    } catch {
      console.error(`skipped ${f}: not JSON`);
    }
  }
  return runs;
}

export function merge(
  data: VerificationFile,
  runs: VerificationRun[],
  detected: Record<string, string>,
  now = new Date().toISOString(),
): VerificationFile {
  const key = (r: VerificationRun) =>
    `${r.target}|${r.upstreamVersion}|${r.os}|${r.verifiedAt}`;
  const have = new Set(data.runs.map(key));
  // Only runs a workflow made, with a link anyone can open, become public record.
  const added = runs.filter(
    (r) =>
      !have.has(key(r)) &&
      r.upstreamVersion !== 'unknown' &&
      /^https:\/\//.test(r.workflowUrl),
  );
  const next: VerificationFile = {
    schemaVersion: 1,
    detected: { ...data.detected },
    runs: [...data.runs, ...added].sort(
      (a, b) =>
        a.target.localeCompare(b.target) || a.verifiedAt.localeCompare(b.verifiedAt),
    ),
  };
  for (const [target, version] of Object.entries(detected))
    if (next.detected[target]?.upstreamVersion !== version)
      next.detected[target] = { upstreamVersion: version, detectedAt: now };
  return next;
}

const REPO_URL = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'Tracetoon/tracetoon'}`;
const label = (id: string) => INTEGRATIONS.find((i) => i.id === id)?.label ?? id;

function gh(args: string[], input?: string) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.status !== 0)
    console.error(`gh ${args.slice(0, 3).join(' ')} failed: ${r.stderr}`);
  return r;
}

function openIssue(labelName: string): number | undefined {
  const r = gh([
    'issue',
    'list',
    '--label',
    labelName,
    '--state',
    'open',
    '--json',
    'number',
    '--limit',
    '1',
  ]);
  return r.status === 0
    ? (JSON.parse(r.stdout)[0]?.number as number | undefined)
    : undefined;
}

function ensureLabel(name: string, color: string, description: string) {
  spawnSync(
    'gh',
    ['label', 'create', name, '--color', color, '--description', description, '--force'],
    {
      encoding: 'utf8',
    },
  );
}

function runLine(r: VerificationRun): string {
  const checks = Object.entries(r.checks)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `- **${r.upstreamVersion}** on ${r.os} (${r.evidence}): ${r.status}${r.failureCategory ? ` (${r.failureCategory})` : ''}. ${checks}. [Run](${r.workflowUrl})${r.detail ? `\n  > ${r.detail.split('\n')[0]}` : ''}`;
}

function syncIssues(runs: VerificationRun[]) {
  ensureLabel(
    'compat-blocked',
    'cccccc',
    'Upstream verification could not run (environment, token or quota)',
  );
  const byIntegration = new Map<string, VerificationRun[]>();
  for (const r of runs)
    byIntegration.set(r.integration, [...(byIntegration.get(r.integration) ?? []), r]);
  for (const [id, list] of byIntegration) {
    const name = `compat:${id}`;
    const failed = list.filter((r) => r.status === 'failed');
    const blocked = list.filter((r) => r.status === 'blocked');
    if (failed.length) {
      ensureLabel(name, 'd73a4a', `${label(id)} upstream compatibility`);
      const body = `A new ${label(id)} release failed Tracetoon's compatibility checks.\n\n${failed.map(runLine).join('\n')}\n\nThe last verified release is in [support.md](${REPO_URL}/blob/main/docs/agents/support.md#recommended-integrations). How the checks work: [support policy](${REPO_URL}/blob/main/docs/agents/support-policy.md#how-recommended-integrations-are-verified). Reproduce with \`bun scripts/compat/verify.ts --integration ${id} --version ${failed[0]!.upstreamVersion} --install --keep\`.`;
      const open = openIssue(name);
      if (open) gh(['issue', 'comment', String(open), '--body-file', '-'], body);
      else
        gh(
          [
            'issue',
            'create',
            '--title',
            `${label(id)} ${failed[0]!.upstreamVersion} fails compatibility checks`,
            '--label',
            name,
            '--body-file',
            '-',
          ],
          body,
        );
    } else if (list.every((r) => r.status === 'passed')) {
      const open = openIssue(name);
      if (open)
        gh([
          'issue',
          'close',
          String(open),
          '--comment',
          `${label(id)} ${list[0]!.upstreamVersion} passed every check:\n\n${list.map(runLine).join('\n')}`,
        ]);
    }
    if (blocked.length) {
      const body = `Verification of ${label(id)} could not run. This is not a compatibility failure.\n\n${blocked.map(runLine).join('\n')}`;
      const open = openIssue('compat-blocked');
      if (open) gh(['issue', 'comment', String(open), '--body-file', '-'], body);
      else
        gh(
          [
            'issue',
            'create',
            '--title',
            'Upstream verification is blocked',
            '--label',
            'compat-blocked',
            '--body-file',
            '-',
          ],
          body,
        );
    }
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      results: { type: 'string' },
      detected: { type: 'string' },
      issues: { type: 'boolean', default: false },
    },
  });
  const runs = values.results ? readRuns(values.results) : [];
  const detected = values.detected
    ? (JSON.parse(values.detected) as Record<string, string>)
    : {};
  const next = merge(readVerification(), runs, detected);
  writeFileSync(VERIFICATION_FILE, JSON.stringify(next, null, 2) + '\n');
  if (values.issues) syncIssues(runs);
  const rows = runs.map(
    (r) =>
      `| ${label(r.integration)} | ${r.upstreamVersion} | ${r.os} | ${r.evidence} | ${r.status}${r.failureCategory ? ` (${r.failureCategory})` : ''} | ${Object.values(r.checks).join(' ')} |`,
  );
  console.log(
    runs.length
      ? `| Agent | Version | Platform | Evidence | Result | Checks (install, end-to-end, hooks, tracing, evidence) |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}`
      : 'No new upstream releases to verify.',
  );
}

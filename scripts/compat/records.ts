/**
 * compat/verification.json: the record of upstream-release verification for
 * Recommended integrations and workflows. The support docs and the compat
 * workflow read it; only the workflow's publish job writes it (through a PR).
 *
 * A run is one (target, version, os) attempt. `detected` holds the newest
 * upstream version seen per target, so a release nobody has verified yet shows
 * as pending instead of silently keeping the old "verified" claim.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const COMPAT_DIR = resolve(import.meta.dir, '../../compat');
export const VERIFICATION_FILE = join(COMPAT_DIR, 'verification.json');

export type RunStatus = 'passed' | 'failed' | 'blocked';
/** What a version's verification amounts to across the required platforms. */
export type VersionStatus = RunStatus | 'pending';
export type Evidence = 'fake-llm' | 'free-plan' | 'fixture-only';
export type CheckId = 'install' | 'hooks' | 'tracing' | 'evidence' | 'end-to-end';
export type CheckResult = 'pass' | 'fail' | 'skip';
/** Only the first five mean Tracetoon is incompatible; infra and quota are blocked runs. */
export type FailureCategory =
  'install' | 'hook-config' | 'hook-protocol' | 'trace' | 'evidence' | 'infra' | 'quota';

export const BLOCKING_CATEGORIES: readonly FailureCategory[] = ['infra', 'quota'];

export interface VerificationRun {
  /** A key of compat/upstream.json (`claude-cli`, `zed-codex`, ...). */
  target: string;
  integration: string;
  surface: string;
  os: string;
  upstreamVersion: string;
  status: RunStatus;
  evidence: Evidence;
  checks: Partial<Record<CheckId, CheckResult>>;
  failureCategory?: FailureCategory;
  /** One line on what failed or what blocked the run. */
  detail?: string;
  verifiedAt: string;
  workflowUrl: string;
  tracetoonRevision: string;
}

export interface VerificationFile {
  schemaVersion: 1;
  detected: Record<string, { upstreamVersion: string; detectedAt: string }>;
  runs: VerificationRun[];
}

export function readVerification(file = VERIFICATION_FILE): VerificationFile {
  if (!existsSync(file)) return { schemaVersion: 1, detected: {}, runs: [] };
  return JSON.parse(readFileSync(file, 'utf8')) as VerificationFile;
}

/**
 * One version's result: failed if any platform failed, blocked if any was
 * blocked (and none failed), passed only when every required platform passed.
 */
export function versionStatus(
  runs: VerificationRun[],
  version: string,
  requiredOs: readonly string[],
): VersionStatus {
  // The newest run per platform counts: a rerun replaces a blocked attempt.
  const latest = new Map<string, VerificationRun>();
  for (const r of runs)
    if (r.upstreamVersion === version) {
      const had = latest.get(r.os);
      if (!had || had.verifiedAt <= r.verifiedAt) latest.set(r.os, r);
    }
  const results = requiredOs.map((os) => latest.get(os)?.status);
  if (results.includes('failed')) return 'failed';
  if (results.includes('blocked')) return 'blocked';
  if (results.length && results.every((s) => s === 'passed')) return 'passed';
  return 'pending';
}

export interface TargetSummary {
  /** The newest version whose required platforms all passed. */
  lastVerified?: {
    version: string;
    at: string;
    os: string[];
    url: string;
    evidence: Evidence;
  };
  /** The newest upstream version known, and where it stands. */
  latest?: { version: string; status: VersionStatus };
  /** 'not yet verified' until a version passes. */
  status: VersionStatus | 'not yet verified';
}

/** What the docs say about a target. Never calls a version verified unless it passed. */
export function summarize(
  data: VerificationFile,
  target: string,
  requiredOs: readonly string[],
): TargetSummary {
  const runs = data.runs.filter((r) => r.target === target);
  const versions = [...new Set(runs.map((r) => r.upstreamVersion))];
  const detected = data.detected[target]?.upstreamVersion;
  if (detected && !versions.includes(detected)) versions.push(detected);
  // Newest first by when each version was first attempted or detected.
  const first = (v: string) =>
    runs
      .filter((r) => r.upstreamVersion === v)
      .map((r) => r.verifiedAt)
      .sort()[0] ??
    data.detected[target]?.detectedAt ??
    '';
  versions.sort((a, b) => first(b).localeCompare(first(a)));

  let lastVerified: TargetSummary['lastVerified'];
  for (const v of versions) {
    if (versionStatus(runs, v, requiredOs) !== 'passed') continue;
    const passed = runs.filter((r) => r.upstreamVersion === v && r.status === 'passed');
    const newest = passed.reduce((a, b) => (a.verifiedAt >= b.verifiedAt ? a : b));
    lastVerified = {
      version: v,
      at: newest.verifiedAt,
      os: [...new Set(passed.map((r) => r.os))].sort(),
      url: newest.workflowUrl,
      evidence: newest.evidence,
    };
    break;
  }
  const newest = versions[0];
  const latest = newest
    ? { version: newest, status: versionStatus(runs, newest, requiredOs) }
    : undefined;
  return {
    lastVerified,
    latest,
    status: latest?.status ?? 'not yet verified',
  };
}

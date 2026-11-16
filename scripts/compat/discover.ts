/**
 * Find upstream releases of Recommended agents that haven't been verified yet.
 *
 *   bun scripts/compat/discover.ts [--target claude-cli] [--version 1.2.3] [--force]
 *
 * Prints {"include": [...], "detected": {...}} for a GitHub Actions matrix: one
 * entry per (target, version, platform) with no recorded result. A platform
 * that already passed, failed or was blocked on that version is skipped unless
 * --force. Versions come from official package feeds (the npm registry), or,
 * for an agent with no feed (Cursor), from its official installer.
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readVerification } from './records.ts';
import upstream from '../../compat/upstream.json';

interface Source {
  type: 'npm' | 'installer';
  package?: string;
  url?: string;
  binary?: string;
}
interface Target {
  integration: string;
  surface: string;
  source: Source;
  evidence: string;
  secret?: string;
  os: string[];
}

export interface MatrixEntry {
  target: string;
  integration: string;
  version: string;
  os: string;
  evidence: string;
  secret: string;
}

/** The newest stable version on npm (the `latest` dist-tag). */
async function npmLatest(pkg: string): Promise<string> {
  const res = await fetch(
    `https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`,
    {
      headers: { accept: 'application/json' },
    },
  );
  if (!res.ok) throw new Error(`npm registry ${pkg}: HTTP ${res.status}`);
  const body = (await res.json()) as { version?: string };
  if (!body.version) throw new Error(`npm registry ${pkg}: no version`);
  return body.version;
}

/**
 * An agent with no package feed (Cursor): run its official installer, which
 * fetches the newest build, and ask the CLI its version. No model is called,
 * so this costs nothing, and it lets an already verified build be skipped.
 */
function installerLatest(t: Target): string {
  if (process.platform === 'win32' || !t.source.url || !t.source.binary)
    throw new Error('installer sources are read on Linux or macOS');
  const install = spawnSync('bash', ['-c', `curl -fsS ${t.source.url} | bash`], {
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (install.status !== 0)
    throw new Error(`installer failed: ${install.stderr.slice(-300)}`);
  const bin = join(homedir(), '.local', 'bin', t.source.binary);
  const v = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000 });
  const version = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(`${v.stdout}${v.stderr}`)?.[0];
  if (!version) throw new Error(`${t.source.binary} --version printed no version`);
  return version;
}

export async function latestVersion(t: Target): Promise<string> {
  if (t.source.type === 'npm' && t.source.package) return npmLatest(t.source.package);
  return installerLatest(t);
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      version: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });
  const data = readVerification();
  const targets = Object.entries(upstream.targets as Record<string, Target>).filter(
    ([key, t]) =>
      !values.target || key === values.target || t.integration === values.target,
  );
  const include: MatrixEntry[] = [];
  const detected: Record<string, string> = {};
  const errors: string[] = [];
  for (const [key, t] of targets) {
    let version: string;
    try {
      version = values.version ?? (await latestVersion(t));
    } catch (e) {
      errors.push(`${key}: ${(e as Error).message}`);
      continue;
    }
    detected[key] = version;
    for (const os of t.os) {
      const seen = data.runs.some(
        (r) => r.target === key && r.upstreamVersion === version && r.os === os,
      );
      if (seen && !values.force) continue;
      include.push({
        target: key,
        integration: t.integration,
        version,
        os,
        evidence: t.evidence,
        secret: t.secret ?? '',
      });
    }
  }
  for (const e of errors) console.error(`could not read a version: ${e}`);
  console.log(JSON.stringify({ include, detected }));
}

if (import.meta.main) await main();

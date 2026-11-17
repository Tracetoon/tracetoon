/**
 * Toolchain versions a repo pins (.bun-version, package.json engines and
 * packageManager, .nvmrc/.node-version, rust-toolchain) that differ from the
 * ones on PATH here. A fresh check that fails under another toolchain may
 * reflect this environment, not the change. Fails open: nothing readable,
 * nothing said.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../util/exec.ts';

const read = (root: string, f: string) => {
  try {
    const p = join(root, f);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  } catch {
    return undefined;
  }
};
const num = (v: string) =>
  (/(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v) ?? []).slice(1).map((x) => Number(x ?? 0));
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/** Whether `running` satisfies the pinned spec (exact, prefix, ^, ~, >=). */
export function satisfies(spec: string, running: string): boolean {
  const s = spec.trim().replace(/^v/, '');
  const r = num(running);
  if (!/\d/.test(s) || /^(?:stable|beta|nightly|lts|latest|\*)/i.test(s)) return true;
  if (/\|\||\s-\s/.test(s)) return true; // ranges too rich to judge: say nothing
  const m = /^(>=|>|<=|<|\^|~|=)?\s*v?([\d.]+)/.exec(s);
  if (!m) return true;
  const p = num(m[2]!);
  const parts = m[2]!.split('.').filter(Boolean).length;
  switch (m[1]) {
    case '>=':
      return cmp(r, p) >= 0;
    case '>':
      return cmp(r, p) > 0;
    case '<=':
      return cmp(r, p) <= 0;
    case '<':
      return cmp(r, p) < 0;
    case '^':
      return r[0] === p[0] && cmp(r, p) >= 0;
    case '~':
      return r[0] === p[0] && r[1] === p[1] && cmp(r, p) >= 0;
    default:
      return r.slice(0, parts).every((x, i) => x === p[i]);
  }
}

const version = (cmd: string, args: string[]) => {
  const r = run(cmd, args, { timeoutMs: 5_000 });
  return r.ok ? (/\d+\.\d+(?:\.\d+)?/.exec(r.stdout)?.[0] ?? undefined) : undefined;
};

/**
 * Each pinned toolchain the running one doesn't satisfy, as
 * "bun 1.2.0 (.bun-version; this environment runs 1.3.14)". `running`
 * overrides the version lookup (tests).
 */
export function toolchainMismatch(
  root: string,
  running: (tool: string) => string | undefined = defaultRunning,
): string[] {
  return pinMismatches(root, running).map(
    (p) => `${p.tool} ${p.spec} (${p.from}; this environment runs ${p.now})`,
  );
}

const defaultRunning = (tool: string) =>
  tool === 'rust' ? version('rustc', ['--version']) : version(tool, ['--version']);

/** A pinned toolchain the running one doesn't satisfy, as parts. */
export interface PinMismatch {
  tool: string;
  spec: string;
  from: string;
  now: string;
}

/** The toolchains a command runs on: its program's, and node under a JS package manager. */
export function commandTools(program: string): string[] {
  const p = program
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(?:exe|cmd)$/i, '');
  if (p === 'bun' || p === 'bunx') return ['bun'];
  if (p === 'node') return ['node'];
  if (['npm', 'npx', 'pnpm', 'yarn'].includes(p))
    return [p === 'npx' ? 'npm' : p, 'node'];
  if (['cargo', 'rustc', 'rustup'].includes(p)) return ['rust'];
  return [];
}

/** Output that says a tool's version is the problem (an engine check, a required version). */
const VERSION_COMPLAINT =
  /\b(?:engines?|toolchain|version)\b[^\n]*\b(?:mismatch|incompatible|unsupported|not supported|required?|requires|expected|wanted|needs?)\b|\b(?:requires?|required|expected|wanted|needs?|unsupported)\b[^\n]*\b(?:bun|node|npm|pnpm|yarn|rustc?|cargo)\b[^\n]*\d+\.\d+|\bEBADENGINE\b/i;

/**
 * Why a failed check could not run as the repository pins it: the command's
 * toolchain differs from the pin and its output complains about a version
 * (or names the running or the pinned version), as "as pinned here (bun
 * 1.3.14 vs pinned 1.2.0)". Undefined otherwise: a failure the code earned.
 */
export function pinnedRunFailure(
  root: string,
  command: string[],
  output: string,
  running: (tool: string) => string | undefined = defaultRunning,
): string | undefined {
  const tools = commandTools(command[0] ?? '');
  if (!tools.length) return undefined;
  const bad = pinMismatches(root, running).filter((p) => tools.includes(p.tool));
  const hit = bad.find(
    (p) =>
      VERSION_COMPLAINT.test(output) ||
      output.includes(p.spec.replace(/^[\^~>=<v\s]+/, '')) ||
      new RegExp(`\\b${p.tool}\\b[^\\n]*\\b${p.now.replace(/\./g, '\\.')}\\b`, 'i').test(
        output,
      ),
  );
  return hit
    ? `as pinned here (${hit.tool} ${hit.now} vs pinned ${hit.spec})`
    : undefined;
}

/** Each pinned toolchain the running one doesn't satisfy. */
export function pinMismatches(
  root: string,
  running: (tool: string) => string | undefined = defaultRunning,
): PinMismatch[] {
  const pins: { tool: string; spec: string; from: string }[] = [];
  const bunVersion = read(root, '.bun-version')?.trim();
  if (bunVersion) pins.push({ tool: 'bun', spec: bunVersion, from: '.bun-version' });
  for (const f of ['.nvmrc', '.node-version']) {
    const v = read(root, f)?.trim();
    if (v) pins.push({ tool: 'node', spec: v, from: f });
  }
  try {
    const pkg = JSON.parse(read(root, 'package.json') ?? '{}') as {
      engines?: Record<string, string>;
      packageManager?: string;
    };
    for (const tool of ['bun', 'node'])
      if (pkg.engines?.[tool])
        pins.push({
          tool,
          spec: pkg.engines[tool]!,
          from: `package.json engines.${tool}`,
        });
    const pm = /^(bun|npm|pnpm|yarn)@([\d.]+)/.exec(pkg.packageManager ?? '');
    if (pm)
      pins.push({ tool: pm[1]!, spec: pm[2]!, from: 'package.json packageManager' });
  } catch {
    // An unreadable package.json pins nothing.
  }
  const rust =
    read(root, 'rust-toolchain')?.trim() ??
    /channel\s*=\s*"([^"]+)"/.exec(read(root, 'rust-toolchain.toml') ?? '')?.[1];
  if (rust) pins.push({ tool: 'rust', spec: rust, from: 'rust-toolchain' });
  const out: PinMismatch[] = [];
  const seen = new Map<string, string | undefined>();
  for (const p of pins) {
    if (!seen.has(p.tool)) seen.set(p.tool, running(p.tool));
    const now = seen.get(p.tool);
    if (!now || satisfies(p.spec, now)) continue;
    out.push({ ...p, now });
  }
  return out;
}

/** Explicit verification receipts; raw output and environment values are never persisted. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { contentFingerprint, readTask } from './state.ts';
import { readLocal, writeLocal } from '../util/localJson.ts';
import type { Run } from '../run.ts';
import type { Run as EvidenceRun } from '../digest/build.ts';
import { makeScrubber } from '../digest/sanitize.ts';
import { publicationLock } from './publication.ts';
import { readSubmittedFile, repoPath } from '../util/repoFiles.ts';
import { dependencyFingerprint } from './validationInputs.ts';
import { count } from '../util/profile.ts';
import { COULD_NOT_RUN } from '../trace/types.ts';

export interface CheckReceipt {
  v: 1;
  name: string;
  command: string[];
  cwd: string;
  kind: EvidenceRun['kind'];
  fingerprint: string;
  environment: string;
  outcome: 'passed' | 'failed' | 'not-run' | 'running';
  exitCode: number | null;
  reason?: string;
  summary: string[];
  /** It failed before running for want of a tool, a dependency or the network: why. */
  couldNotRun?: string;
  /** `fingerprint` over tracked files only: the code tree it ran on, for reuse. */
  tracked?: string;
  startedAt: string;
  durationMs: number;
  commandSha256?: string;
  inputs?: string[];
  reuse?: { state: 'executed' | 'reused'; reason: string; matchedName?: string };
}
export const receipts = (run: Run): CheckReceipt[] =>
  readLocal<CheckReceipt[]>(join(run.dir, 'checks.json')) ?? [];
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function inputFingerprint(
  root: string,
  inputs: string[],
  content = contentFingerprint(root),
  dependency = dependencyFingerprint(root),
): string {
  const complete = dependency === null ? content : hash([content, dependency]);
  if (!inputs.length) return complete;
  return hash([
    complete,
    [...new Set(inputs)].sort().map((path) => {
      if (!repoPath(path))
        throw new Error(
          'Extra validation inputs must be public worktree-relative files.',
        );
      return [
        path,
        createHash('sha256').update(readSubmittedFile(root, path)).digest('hex'),
      ];
    }),
  ]);
}
/**
 * Variables a coding agent sets to describe its own session, not the code,
 * toolchain or test environment. They change mid-task: Codex's per-call id, and
 * Claude Code's effort level, attended flag, ids and version string.
 */
const HOST_SESSION_VARS =
  /^(CODEX_TOOL_CALL_ID|CODEX_THREAD_ID|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_SESSION_ATTENDED|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_MESSAGING_\w+|AI_AGENT)$/;

/** A result line's shape: its numbers, timings and paths blanked, so suites' lines compare equal. */
const lineShape = (l: string) =>
  l
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\S*[/\\]\S*/g, 'P')
    .replace(/\d+(?:\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Result lines of a check's output: the last three that report counts.
 * stderr is read before stdout, so a wrapper's own total on stdout ("46 passed,
 * 0 failed") wins over the last child's per-file lines on stderr; a runner that
 * writes only one stream is unaffected. When the output holds several suites'
 * results (the same kind of line more than once), only the aggregate after
 * them is kept, or no count at all: the last suite's numbers are not the run's.
 */
export function checkSummary(
  stdout: string,
  stderr: string,
  scrub: (text: string) => string = (t) => t,
): string[] {
  const lines = scrub(`${stderr}\n${stdout}`)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter((s) =>
      /\b\d+\s+(?:pass(?:ed|es)?|fail(?:ed|ures?|s)?|tests?|checks?)\b|\b(?:Tests|Test Files):/i.test(
        s,
      ),
    );
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(lineShape(l), (seen.get(lineShape(l)) ?? 0) + 1);
  const lastRepeat = lines.findLastIndex((l) => seen.get(lineShape(l))! > 1);
  const kept =
    lastRepeat < 0
      ? lines
      : lines.slice(lastRepeat + 1).filter((l) => seen.get(lineShape(l)) === 1);
  return kept.slice(-3).map((s) => s.slice(0, 200));
}

/**
 * Output that says the check could not start here: its tool is missing, a
 * dependency could not be fetched, or the network was refused. Matched only
 * when the check printed no result line of a runner (see `setupFailure`).
 */
const SETUP_ERROR = [
  /\bcommand not found\b/i,
  /^\S+:\s*(?:(?:line\s+)?\d+:\s*)?[\w.+-]+:\s*not found$/i, // sh: 1: cargo: not found
  /\bis not recognized as an internal or external command\b/i,
  /\b(?:spawn|spawnSync)\s+\S+\s+ENOENT\b/,
  /\bno such file or directory\b.*\b(?:exec|spawn|command|program|binary)\b|\b(?:exec|spawn)\b.*\bno such file or directory\b/i,
  /\b(?:could not|couldn't|unable to|failed to)\s+(?:resolve|connect|download|fetch|reach|access)\b/i,
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH)\b/,
  /\bgetaddrinfo\b|\bnetwork is unreachable\b|\bname or service not known\b|\btemporary failure in name resolution\b/i,
  /\btransport '[a-z]+' not allowed\b/i,
  /\berror sending request\b|\bproxy\b.*\b(?:error|refused|denied)\b/i,
  /\b(?:toolchain|interpreter|runtime)\b.*\b(?:not installed|not found|missing)\b|\bnot installed\b/i,
];

/**
 * A module or package the runtime could not load, by name: a bare package
 * name (`zod`, `@scope/pkg`, a Python module) is a dependency this environment
 * lacks; a relative or absolute path is the code's own import and a real
 * failure.
 */
const MISSING_MODULE = [
  /\bcannot find (?:module|package) ['"`]([^'"`]+)['"`]/i,
  /\bModuleNotFoundError: No module named ['"`]([^'"`]+)['"`]/,
  /\bModule not found: (?:Error: )?Can't resolve ['"`]([^'"`]+)['"`]/i,
  /\bCould not resolve ['"`]([^'"`]+)['"`]/,
];
const bareModule = (name: string) =>
  !/^(?:\.{1,2}[/\\]|[/\\~]|<repo>|[A-Za-z]:[/\\])/.test(name);
/** A line saying a dependency is missing here (see `MISSING_MODULE`). */
const missingDependency = (line: string) =>
  MISSING_MODULE.some((re) => {
    const m = re.exec(line);
    return !!m?.[1] && bareModule(m[1]);
  });
/**
 * Output that says the environment failed even though a runner printed its
 * results: a dependency that could not load, a tool not found, or a host
 * name that could not be looked up (the network is blocked). A refused
 * connection alone is not here: a test may be checking exactly that.
 */
const ENVIRONMENT_ERROR = [
  /\bcommand not found\b/i,
  /^\S+:\s*(?:(?:line\s+)?\d+:\s*)?[\w.+-]+:\s*not found$/i,
  /\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH)\b/,
  /\bgetaddrinfo\b|\bnetwork is unreachable\b|\btemporary failure in name resolution\b/i,
];

/**
 * Why a failed check could not run in this environment, in a short phrase,
 * when its output (or the spawn error) says the tool, a dependency or the
 * network was unavailable: before any runner result line, any `SETUP_ERROR`;
 * after result lines, only a missing dependency or an `ENVIRONMENT_ERROR`
 * (tests that could not load say nothing about the code). Undefined for a
 * check that ran and failed.
 */
export function setupFailure(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  error?: Error,
  scrub: (text: string) => string = (t) => t,
): string | undefined {
  const ran = checkSummary(stdout, stderr).length > 0;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'the command was not found';
  const text = scrub(`${stderr}\n${stdout}`).replace(/\x1b\[[0-9;]*m/g, '');
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const line =
    lines.find(missingDependency) ??
    lines.find((l) => (ran ? ENVIRONMENT_ERROR : SETUP_ERROR).some((re) => re.test(l)));
  if (ran && !line) return undefined;
  if (line)
    return line
      .replace(/^(?:error|fatal|warning)(?:\[[^\]]*\])?:\s*/i, '')
      .replace(/[.:;]+$/, '')
      .slice(0, 120);
  if (exitCode === 127) return 'the command was not found';
  return undefined;
}
/**
 * Terminal, display and temp-directory variables: they differ between shells
 * of one machine without changing what a check does, so they don't invalidate
 * a receipt.
 */
const VOLATILE_VARS =
  /^(TMPDIR|TMP|TEMP|TERM|TERM_PROGRAM\w*|COLORTERM|COLUMNS|LINES|DISPLAY|WAYLAND_DISPLAY|WINDOWID|DBUS_SESSION_BUS_ADDRESS|XDG_SESSION_\w+|XDG_RUNTIME_DIR|SSH_\w+|VTE_VERSION|KITTY_\w+|ITERM_\w+|TMUX\w*|STY|WT_SESSION|WT_PROFILE_ID)$/;
export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  // Hash, don't log, the environment. Changed PATH/toolchain/options invalidate reuse.
  return hash([
    process.platform,
    process.arch,
    process.version,
    (globalThis as { Bun?: { version: string } }).Bun?.version ?? null,
    Object.entries(env)
      .filter(
        ([k]) =>
          !/^(TRACETOON|FAKE_|_|PWD$|OLDPWD$|SHLVL$|SHELL$)/.test(k) &&
          !HOST_SESSION_VARS.test(k) &&
          !VOLATILE_VARS.test(k),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
export function checkKind(command: string): EvidenceRun['kind'] {
  if (/typecheck|\btsc\b/i.test(command)) return 'typecheck';
  if (/lint|prettier/i.test(command)) return 'lint';
  if (/\btest|pytest|vitest/i.test(command)) return 'test';
  if (/build|bundle|compile/i.test(command)) return 'build';
  if (/\beval/i.test(command)) return 'eval';
  return 'other';
}
interface CheckOptions {
  name: string;
  cwd?: string;
  command: string[];
  skip?: string;
  force?: boolean;
  onStart?: (receipt: CheckReceipt) => void;
  input?: string[];
}
export function executeCheck(
  root: string,
  run: Run,
  opts: CheckOptions,
): CheckReceipt & { reused?: boolean } {
  return publicationLock(
    run,
    () => {
      const prepared = prepareCheck(root, run, opts);
      if ('cached' in prepared) return prepared.cached;
      const result = opts.skip
        ? undefined
        : spawnSync(opts.command[0]!, opts.command.slice(1), {
            cwd: prepared.cwd,
            env: process.env,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
          });
      if (result?.stdout) process.stderr.write(result.stdout);
      if (result?.stderr) process.stderr.write(result.stderr);
      return prepared.finish(result);
    },
    'checks.lock',
  );
}
interface CheckResult {
  status: number | null;
  error?: Error;
  stdout: string;
  stderr: string;
}
export function executeCheckLive(
  root: string,
  run: Run,
  opts: CheckOptions,
): Promise<CheckReceipt & { reused?: boolean }> {
  return publicationLock(
    run,
    async () => {
      const prepared = prepareCheck(root, run, opts);
      if ('cached' in prepared) return prepared.cached;
      const result = opts.skip
        ? undefined
        : await streamCheck(opts.command, prepared.cwd);
      return prepared.finish(result);
    },
    'checks.lock',
  );
}
function streamCheck(command: string[], cwd: string): Promise<CheckResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '',
      stderr = '',
      error: Error | undefined,
      bytes = 0;
    const interrupt = (signal: NodeJS.Signals) => {
      error ??= new Error(`Validation interrupted by ${signal}.`);
      child.kill(signal);
    };
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const capture = (text: string, isError: boolean) => {
      process.stderr.write(text);
      bytes += Buffer.byteLength(text);
      if (bytes > 64 * 1024 * 1024) {
        error ??= new Error('Validation output exceeded the 64 MiB capture limit.');
        child.kill();
        return;
      }
      if (isError) stderr += text;
      else stdout += text;
    };
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (text: string) => capture(text, false));
    child.stderr!.on('data', (text: string) => capture(text, true));
    child.on('error', (failure) => {
      error ??= failure;
    });
    child.once('close', (status) => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolveResult({ status, error, stdout, stderr });
    });
  });
}
function prepareCheck(
  root: string,
  run: Run,
  opts: CheckOptions,
):
  | { cached: CheckReceipt & { reused?: boolean } }
  | { cwd: string; finish: (result: CheckResult | undefined) => CheckReceipt } {
  const cwd = resolve(root, opts.cwd ?? '.');
  const rel = relative(root, cwd).replace(/\\/g, '/');
  if (
    rel === '..' ||
    rel.startsWith('../') ||
    resolve(root, rel) !== cwd ||
    !existsSync(cwd)
  )
    throw new Error('Check directory must be inside this worktree.');
  if (!opts.name.trim() || (!opts.command.length && !opts.skip?.trim()))
    throw new Error('Supply a check command or an explicit --skip reason.');
  const fingerprint = inputFingerprint(root, opts.input ?? []);
  const tracked = inputFingerprint(
    root,
    opts.input ?? [],
    contentFingerprint(root, true),
  );
  const environment = checkEnvironment();
  const safeName = makeScrubber([root]).text(opts.name);
  const previous = receipts(run);
  // The latest receipt of this command on the same code tree (tracked files
  // unchanged; untracked drafts beside it don't matter), here or in another
  // run of this repository: rerunning it would say the same. A check the
  // environment stopped is rerun, as the environment may have been fixed.
  const old =
    opts.force || opts.skip
      ? undefined
      : latestReceipt(run, previous, {
          fingerprint,
          tracked,
          environment,
          cwd: rel,
          command: hash(opts.command),
        });
  if (old) {
    count('check.reused');
    const reused = {
      ...old,
      name: safeName,
      // Current again: the content it ran on is the content now.
      fingerprint,
      tracked,
      reused: true,
      reuse: {
        state: 'reused' as const,
        reason:
          old.fingerprint === fingerprint
            ? 'Exact command, inputs, directory and environment match.'
            : 'Same command, directory and environment, and the tracked code is unchanged since this receipt; pass --force to rerun.',
        matchedName: old.name,
      },
    };
    if (
      old.name !== safeName ||
      old.fingerprint !== fingerprint ||
      !previous.includes(old)
    )
      writeLocal(join(run.dir, 'checks.json'), [
        ...previous.filter((c) => c.name !== safeName),
        reused,
      ]);
    return { cached: reused };
  }
  count('check.executed');
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const scrub = makeScrubber([root]);
  const running: CheckReceipt = {
    v: 1,
    name: safeName,
    command: opts.command.map((c) => scrub.text(atRepo(c, root))),
    commandSha256: hash(opts.command),
    cwd: rel,
    kind: checkKind(`${opts.name} ${opts.command.join(' ')}`),
    fingerprint,
    inputs: opts.input,
    environment,
    outcome: 'running',
    exitCode: null,
    summary: [],
    startedAt,
    durationMs: 0,
  };
  writeLocal(join(run.dir, 'checks.json'), [
    ...previous.filter((c) => c.name !== safeName),
    running,
  ]);
  opts.onStart?.(running);
  return {
    cwd,
    finish: (result) => {
      const after = inputFingerprint(root, opts.input ?? []);
      const couldNotRun =
        !opts.skip && after === fingerprint && (result?.status !== 0 || result.error)
          ? setupFailure(
              result?.stdout ?? '',
              result?.stderr ?? '',
              result?.status ?? null,
              result?.error,
              (t) => makeScrubber([root]).text(t),
            )
          : undefined;
      const receipt: CheckReceipt = {
        v: 1,
        name: safeName,
        command: opts.command.map((c) => scrub.text(atRepo(c, root))),
        commandSha256: hash(opts.command),
        cwd: rel,
        kind: checkKind(`${opts.name} ${opts.command.join(' ')}`),
        fingerprint,
        tracked,
        inputs: opts.input,
        environment,
        outcome: opts.skip
          ? 'not-run'
          : result?.status === 0 && !result.error && after === fingerprint
            ? 'passed'
            : 'failed',
        exitCode: result?.status ?? null,
        reason:
          scrub.text(
            opts.skip ??
              (after !== fingerprint
                ? 'The command changed validation inputs; run checks after finalizing those changes.'
                : (result?.error?.message ?? '')),
          ) || undefined,
        // A check the environment stopped keeps no pass/fail counts: they
        // say nothing about the code.
        summary: couldNotRun
          ? []
          : checkSummary(result?.stdout ?? '', result?.stderr ?? '', (t) =>
              makeScrubber([root]).text(t),
            ),
        couldNotRun,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        reuse: {
          state: 'executed',
          reason: opts.force
            ? 'Explicitly forced.'
            : 'No passing receipt matches the current command, inputs, directory and environment.',
        },
      };
      writeLocal(join(run.dir, 'checks.json'), [
        ...previous.filter((c) => c.name !== safeName),
        receipt,
      ]);
      return receipt;
    },
  };
}
/**
 * The newest finished receipt (passed, or failed on the code) for this
 * command, directory and environment whose content matches exactly or whose
 * tracked code tree matches: in this run first, then in the repository's
 * other runs, newest first.
 */
function latestReceipt(
  run: Run,
  previous: CheckReceipt[],
  want: {
    fingerprint: string;
    tracked: string;
    environment: string;
    cwd: string;
    command: string;
  },
): CheckReceipt | undefined {
  const fits = (c: CheckReceipt) =>
    // A failure is the code's only with a nonzero exit and no environment
    // stop (an exit-0 failure means the command changed its own inputs).
    (c.outcome === 'passed' ||
      (c.outcome === 'failed' && !c.couldNotRun && !!c.exitCode)) &&
    c.environment === want.environment &&
    c.cwd === want.cwd &&
    (c.commandSha256 ?? hash(c.command)) === want.command &&
    (c.fingerprint === want.fingerprint || c.tracked === want.tracked);
  const newest = (xs: CheckReceipt[]) =>
    xs
      .filter(fits)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
  const here = newest(previous);
  if (here) return here;
  let others: CheckReceipt[] = [];
  try {
    const runs = dirname(run.dir);
    others = readdirSync(runs, { withFileTypes: true })
      .filter(
        (d) => d.isDirectory() && !d.isSymbolicLink() && d.name !== basename(run.dir),
      )
      .flatMap((d) => readLocal<CheckReceipt[]>(join(runs, d.name, 'checks.json')) ?? [])
      .filter((c) => c && c.v === 1);
  } catch {
    return undefined;
  }
  return newest(others);
}
export function checkReport(root: string, run: Run) {
  const fingerprint = contentFingerprint(root);
  const dependency = dependencyFingerprint(root);
  const environment = checkEnvironment();
  return receipts(run).map((c) => ({
    ...c,
    current: (() => {
      try {
        return (
          c.fingerprint ===
            inputFingerprint(root, c.inputs ?? [], fingerprint, dependency) &&
          c.environment === environment
        );
      } catch {
        return false;
      }
    })(),
  }));
}
/**
 * A `tracetoon check` receipt that passed on the content as it is now (and in
 * this environment). Read from the run folder when the brief is read, so a
 * check run after `prepare` retires "no passing run after the last commit"
 * without a rebuilt graph. False when there is no receipt or no known root.
 */
export function passOnSubmittedContent(run: Run, root?: string): boolean {
  if (!receipts(run).some((c) => c.outcome === 'passed')) return false;
  const at = root ?? readTask(run)?.root;
  if (!at) return false;
  try {
    return checkReport(at, run).some((c) => c.current && c.outcome === 'passed');
  } catch {
    return false;
  }
}
/**
 * Paths inside the repository written as `<repo>/…`, so an absolute path the
 * command used stays distinguishable from a relative one (the scrubber alone
 * strips the root, which made a passing absolute-path retry read as the failed
 * relative-path attempt; conf21 pr12).
 */
function atRepo(arg: string, root: string): string {
  const roots = [root];
  try {
    const real = realpathSync(root);
    if (real !== root) roots.push(real);
  } catch {
    /* the root as given */
  }
  let out = arg;
  for (const r of roots) out = out.split(`${r}/`).join('<repo>/').split(r).join('<repo>');
  return out;
}

/** argv as a shell would need it typed: arguments with spaces or shell characters quoted. */
export function shellJoin(argv: string[]): string {
  return argv
    .map((a) =>
      a === '' ? "''" : /[^\w@%+=:,./<>-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a,
    )
    .join(' ');
}

export function receiptEvidence(
  root: string,
  run: Run,
  // Reuse a report the caller already computed (fingerprinting walks every file).
  report: ReturnType<typeof checkReport> = checkReport(root, run),
): EvidenceRun[] {
  return report
    .filter((c) => c.current && ['passed', 'failed'].includes(c.outcome))
    .map((c, i) => ({
      id: `V${i + 1}`,
      cmd: shellJoin(c.command),
      kind: c.kind,
      outcome: c.outcome as 'passed' | 'failed',
      basis: 'exit status',
      // A check that could not start here says why, in place of result lines.
      summary:
        c.outcome === 'failed' && c.couldNotRun
          ? [`${COULD_NOT_RUN}${c.couldNotRun}`]
          : c.summary,
      t: c.startedAt,
      revision: 'no later edits seen',
      verificationBasis: 'exact-content-receipt',
    }));
}

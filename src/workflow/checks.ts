/** Explicit verification receipts. Receipts keep no raw output or environment values; the scrubbed output of a run is saved in the local run folder (`check-logs/`) for the agent to read. */
import { isHostSessionVar } from '../integrations/registry.ts';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
import { forgetGitAnswers } from '../util/exec.ts';
import { COULD_NOT_RUN, TIMED_OUT } from '../trace/types.ts';
import { pinnedRunFailure } from '../graph/toolchain.ts';

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
  /** The full output, saved in the run folder (`check-logs/`). */
  log?: string;
  /** Failing test names the output shows (at most a few). */
  failing?: string[];
  /** It was stopped after the timeout: incomplete, neither a pass nor a failure. */
  timedOut?: boolean;
  /** The limit it ran under, when it timed out. */
  timeoutMs?: number;
}

/** Default limit on one check's run time; `--timeout` or TRACETOON_CHECK_TIMEOUT_MIN overrides it. */
export const CHECK_TIMEOUT_MS = 15 * 60_000;
export function checkTimeoutMs(minutes?: string | number): number {
  const m = Number(minutes ?? process.env.TRACETOON_CHECK_TIMEOUT_MIN ?? '');
  return Number.isFinite(m) && m > 0 ? Math.round(m * 60_000) : CHECK_TIMEOUT_MS;
}
/** Lines of a check's output echoed live; the rest is in the saved log. */
const ECHO_LINES = 40;

/** Failing test names in a check's output: bun, jest/vitest, pytest, go, cargo, mocha. */
export function failingTests(output: string, max = 8): string[] {
  const out: string[] = [];
  const add = (x: string | undefined) => {
    const t = x
      ?.replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\s*\[[\d.]+m?s\]\s*$/, '')
      .trim();
    if (t && !out.includes(t) && out.length < max)
      out.push(t.length > 160 ? `${t.slice(0, 159)}…` : t);
  };
  for (const raw of output.split('\n')) {
    const l = raw.replace(/\x1b\[[0-9;]*m/g, '');
    let m: RegExpExecArray | null;
    if ((m = /^\s*\(fail\)\s+(.+)$/.exec(l))) add(m[1]);
    else if ((m = /^\s*(?:✗|✕|×)\s+(.+)$/.exec(l))) add(m[1]);
    else if ((m = /^\s*FAIL\s+(\S.+)$/.exec(l))) add(m[1]);
    else if ((m = /^FAILED\s+(\S+)/.exec(l))) add(m[1]);
    else if ((m = /^\s*--- FAIL:\s+(\S+)/.exec(l))) add(m[1]);
    else if ((m = /^test\s+(\S+)\s+\.\.\.\s+FAILED/.exec(l))) add(m[1]);
  }
  return out;
}

/** A time limit in words: minutes, or seconds under a minute. */
const limitText = (ms: number) =>
  ms >= 60_000
    ? `${Math.round(ms / 60_000)} min`
    : `${Math.max(1, Math.round(ms / 1000))} s`;
/** How a timed-out check reads everywhere: incomplete, never "failed". */
export const timedOutText = (durationMs: number) =>
  `${TIMED_OUT}, ${Math.round(durationMs / 1000)} s`;
/** What to do after a timeout, said once where it is printed. */
const TIMEOUT_ADVICE =
  "don't rerun it: report it as timed out (incomplete), with no pass/fail result";

/** The few lines `tracetoon check` prints: outcome, counts, failing tests, the log. */
export function compactCheckText(r: CheckReceipt & { reused?: boolean }): string {
  const head = r.timedOut
    ? `${r.name}: ${timedOutText(r.durationMs)}${r.reused ? ' (reused: it timed out on this code before)' : ''}; ${TIMEOUT_ADVICE}`
    : r.outcome === 'failed' && r.couldNotRun
      ? `${r.name}: could not run ${/^as pinned here\b/.test(r.couldNotRun) ? r.couldNotRun : `in this environment (${r.couldNotRun})`}; this says nothing about the code${r.reused ? ' (reused unchanged inputs)' : ''}; ${r.durationMs}ms`
      : `${r.name}: ${r.outcome}${r.reused ? ' (reused unchanged inputs)' : ''}; ${r.durationMs}ms${r.reason ? `; ${r.reason}` : ''}`;
  return [
    head,
    ...(r.timedOut ? [] : r.summary.slice(0, 4).map((x) => `  ${x}`)),
    ...(!r.timedOut && r.failing?.length
      ? ['  failing:', ...r.failing.slice(0, 10).map((x) => `  - ${x}`)]
      : []),
    ...(r.log ? [`  full log: ${r.log}`] : []),
  ]
    .slice(0, 20)
    .join('\n');
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
const HOST_SESSION_VARS = { test: isHostSessionVar };

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
  // Also what an agent's shell tool sets for itself on Windows: cmd's prompt,
  // PowerShell's execution policy, and the git/colour settings that keep a tool
  // call from prompting or colouring output.
  /^(TMPDIR|TMP|TEMP|TERM|TERM_PROGRAM\w*|COLORTERM|COLUMNS|LINES|DISPLAY|WAYLAND_DISPLAY|WINDOWID|DBUS_SESSION_BUS_ADDRESS|XDG_SESSION_\w+|XDG_RUNTIME_DIR|SSH_\w+|VTE_VERSION|KITTY_\w+|ITERM_\w+|TMUX\w*|STY|WT_SESSION|WT_PROFILE_ID|PROMPT|PSExecutionPolicyPreference|GCM_INTERACTIVE|GIT_TERMINAL_PROMPT|GIT_ASKPASS|NO_COLOR|PLINK_PROTOCOL)$/;
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
  /** Stop the command after this long (default CHECK_TIMEOUT_MS). */
  timeoutMs?: number;
  /**
   * Echo the first output lines on stderr while the check runs. Off by
   * default: an agent's exec tool (Codex) returns at its yield time either
   * way, and streamed lines only cost tokens on every poll. The live output
   * always goes to `check-logs/running.log` until the receipt is written.
   */
  progress?: boolean;
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
            timeout: opts.timeoutMs ?? checkTimeoutMs(),
            killSignal: 'SIGKILL',
          });
      if (opts.progress && result?.stdout) process.stderr.write(result.stdout);
      if (opts.progress && result?.stderr) process.stderr.write(result.stderr);
      // The check is the user's own command and may have changed the repository.
      if (result) forgetGitAnswers();
      const timedOut =
        !!result &&
        result.status === null &&
        (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
      return prepared.finish(
        result && timedOut
          ? {
              ...result,
              error: new Error(
                `Stopped at the ${limitText(opts.timeoutMs ?? checkTimeoutMs())} limit; incomplete, not a failure.`,
              ),
              timedOut,
            }
          : result,
      );
    },
    'checks.lock',
  );
}
interface CheckResult {
  status: number | null;
  error?: Error;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
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
      const live = opts.skip ? undefined : liveLog(run);
      const result = opts.skip
        ? undefined
        : await streamCheck(
            opts.command,
            prepared.cwd,
            opts.timeoutMs ?? checkTimeoutMs(),
            !!opts.progress,
            live,
          );
      if (result) forgetGitAnswers();
      if (live) rmQuiet(live);
      return prepared.finish(result);
    },
    'checks.lock',
  );
}
/** Where a running check's raw output goes until its scrubbed log is saved. */
function liveLog(run: Run): string | undefined {
  try {
    const dir = join(run.dir, 'check-logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'running.log');
    writeFileSync(file, '');
    return file;
  } catch {
    return undefined;
  }
}
function rmQuiet(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}
function streamCheck(
  command: string[],
  cwd: string,
  timeoutMs = CHECK_TIMEOUT_MS,
  echo = false,
  live?: string,
): Promise<CheckResult> {
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      error ??= new Error(
        `Stopped at the ${limitText(timeoutMs)} limit; incomplete, not a failure.`,
      );
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    let echoed = 0;
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const capture = (text: string, isError: boolean) => {
      if (live)
        try {
          appendFileSync(live, text);
        } catch {
          /* the saved log still gets the output */
        }
      // With --progress, the first lines show on stderr; the rest goes to the log only.
      if (echo && echoed < ECHO_LINES) {
        const lines = text.split('\n');
        const room = ECHO_LINES - echoed;
        process.stderr.write(lines.slice(0, room).join('\n'));
        echoed += lines.length - 1;
        if (echoed >= ECHO_LINES)
          process.stderr.write('\n… (output continues in the saved log)\n');
      }
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
      clearTimeout(timer);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolveResult({ status, error, stdout, stderr, timedOut });
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
          timeoutMs: opts.timeoutMs ?? checkTimeoutMs(),
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
        reason: old.timedOut
          ? 'It timed out on this code under the same or a longer limit; a rerun would time out again (pass --force to rerun anyway).'
          : old.fingerprint === fingerprint
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
      // A failure under a toolchain other than the repository pins, whose
      // output complains about the version: the run says nothing about the code.
      const notAsPinned =
        !couldNotRun &&
        !opts.skip &&
        result &&
        !result.timedOut &&
        result.status !== 0 &&
        after === fingerprint
          ? pinnedRunFailure(
              root,
              opts.command,
              makeScrubber([root]).text(`${result.stdout}\n${result.stderr}`),
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
        summary:
          couldNotRun || notAsPinned
            ? []
            : checkSummary(result?.stdout ?? '', result?.stderr ?? '', (t) =>
                makeScrubber([root]).text(t),
              ),
        couldNotRun: couldNotRun ?? notAsPinned,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        reuse: {
          state: 'executed',
          reason: opts.force
            ? 'Explicitly forced.'
            : 'No passing receipt matches the current command, inputs, directory and environment.',
        },
      };
      if (result) {
        const output = makeScrubber([root]).text(`${result.stdout}\n${result.stderr}`);
        const failing =
          receipt.outcome === 'failed' && !receipt.couldNotRun
            ? failingTests(output)
            : [];
        if (failing.length) receipt.failing = failing;
        if (result.timedOut) {
          receipt.timedOut = true;
          receipt.timeoutMs = opts.timeoutMs ?? checkTimeoutMs();
          receipt.summary = [];
          delete receipt.failing;
          delete receipt.couldNotRun;
        }
        try {
          const dir = join(run.dir, 'check-logs');
          mkdirSync(dir, { recursive: true });
          const file = join(
            dir,
            `${safeName.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'check'}.log`,
          );
          writeFileSync(file, output);
          receipt.log = file;
        } catch {
          // No saved log; the receipt is whole.
        }
      }
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
    /** This attempt's limit: a timeout under the same or a longer one would repeat. */
    timeoutMs?: number;
  },
): CheckReceipt | undefined {
  const fits = (c: CheckReceipt) =>
    // A failure is the code's only with a nonzero exit and no environment
    // stop (an exit-0 failure means the command changed its own inputs).
    (c.outcome === 'passed' ||
      (c.outcome === 'failed' && !c.couldNotRun && !!c.exitCode) ||
      (c.timedOut === true &&
        (c.timeoutMs ?? CHECK_TIMEOUT_MS) >= (want.timeoutMs ?? CHECK_TIMEOUT_MS))) &&
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
  return receipts(run).map((c) => {
    // Evidence follows the content: a check that passed on exactly this content
    // still did when the next command runs in another shell (Git Bash and
    // PowerShell differ in PATH and a dozen variables). Reuse (latestReceipt)
    // still needs the same environment; here a difference is only noted.
    const sameContent = (() => {
      try {
        return (
          c.fingerprint ===
          inputFingerprint(root, c.inputs ?? [], fingerprint, dependency)
        );
      } catch {
        return false;
      }
    })();
    return {
      ...c,
      current: sameContent,
      ...(sameContent && c.environment !== environment
        ? { environmentChanged: true as const }
        : {}),
    };
  });
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

/**
 * A receipt's command as typed from the repository root: `<repo>/x` → `x`,
 * `<repo>` → `.` (a PR shows no local placeholder or absolute path).
 */
export function repoRelative(argv: string[]): string[] {
  return argv.map((a) =>
    a
      .replace(/<repo>\//g, '')
      .replace(/(^|[=\s:])<repo>(?=$|[\s:])/g, '$1.')
      .replace(/^<repo>$/, '.'),
  );
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
  const current = report.filter(
    (c) => c.current && ['passed', 'failed'].includes(c.outcome),
  );
  // Two distinct commands that read alike once `<repo>/` is dropped (an
  // absolute-path retry of a relative-path run) keep the prefix, so a pass of
  // one never reads as, or replaces, a failure of the other.
  const relative = (c: (typeof current)[number]) => shellJoin(repoRelative(c.command));
  const variants = new Map<string, Set<string>>();
  for (const c of current)
    variants.set(
      relative(c),
      (variants.get(relative(c)) ?? new Set()).add(shellJoin(c.command)),
    );
  return current.map((c, i) => ({
    id: `V${i + 1}`,
    cmd: (variants.get(relative(c))?.size ?? 0) > 1 ? shellJoin(c.command) : relative(c),
    kind: c.kind,
    // A timeout is incomplete: no outcome, its own result line.
    outcome: c.timedOut ? ('unknown' as const) : (c.outcome as 'passed' | 'failed'),
    basis: 'exit status',
    // A check that could not start here says why, in place of result lines.
    summary: c.timedOut
      ? [timedOutText(c.durationMs)]
      : c.outcome === 'failed' && c.couldNotRun
        ? [`${COULD_NOT_RUN}${c.couldNotRun}`]
        : c.summary,
    t: c.startedAt,
    revision: 'no later edits seen',
    verificationBasis: 'exact-content-receipt',
    ...(c.environmentChanged ? { environmentChanged: true as const } : {}),
  }));
}

/** package.json scripts that check the code (not `pretest`-style hooks). */
const CHECK_SCRIPT = /^(?:test|check|typecheck|type-check|tsc|lint)(?::\S+)?$/;

/**
 * The checks a repository declares for itself, found generically: package.json
 * scripts named test/check/typecheck/lint, a Makefile `test:`/`check:` target,
 * or a Cargo, Go or pytest project. Each entry is how to run it.
 */
export function declaredChecks(root: string): string[] {
  const out: string[] = [];
  const read = (f: string) => {
    try {
      return readFileSync(join(root, f), 'utf8');
    } catch {
      return undefined;
    }
  };
  const pkg = read('package.json');
  if (pkg)
    try {
      const scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts;
      for (const [name, cmd] of Object.entries(scripts ?? {}))
        if (
          CHECK_SCRIPT.test(name) &&
          typeof cmd === 'string' &&
          !/no test specified/i.test(cmd)
        )
          out.push(`npm run ${name}`);
    } catch {
      /* not JSON: no scripts */
    }
  const make = read('Makefile');
  if (make)
    for (const t of ['test', 'check'])
      if (new RegExp(`^${t}\\s*:`, 'm').test(make)) out.push(`make ${t}`);
  if (read('Cargo.toml')) out.push('cargo test');
  if (read('go.mod')) out.push('go test ./...');
  const py = read('pyproject.toml');
  if (py && /\[tool\.pytest/.test(py)) out.push('pytest');
  return out;
}

/**
 * Why publishing lacks check evidence: the repository declares checks but the
 * run holds no `tracetoon check` receipt at all (a pass, a failure or a
 * recorded `--skip` reason each count). Undefined when nothing is missing.
 */
export function checkReceiptGap(run: Run, root: string): string | undefined {
  const declared = declaredChecks(root);
  if (!declared.length || receipts(run).length) return undefined;
  return `The repository declares checks (${declared.slice(0, 4).join(', ')}) but this run has no check receipt. Run each one on its own: tracetoon check --run ${run.id} --name <check> -- <program> <args> (one command per check, no chained bash -c '… && …'), or record why it can't run: tracetoon check --run ${run.id} --name <check> --skip "<reason>".`;
}

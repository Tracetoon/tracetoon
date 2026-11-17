/** Bound concurrency while giving every test file its own OS process. */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { privateRepoPath } from '../src/util/repoFiles.ts';

/**
 * How many test files run at once. One fresh process per file either way; this
 * only bounds how many are in flight.
 *
 * The pinned Bun's subprocess-heavy suites fail intermittently on macOS when the
 * machine is oversubscribed, so macOS used to run one file at a time everywhere.
 * That is the right call on a CI runner, which has 3-4 cores, and a needless 3x
 * on a developer Mac, which has far more: with 10 cores the full suite takes
 * 176s serially and 56s at four workers. Cores decide instead of the platform
 * alone, so CI keeps the conservative behaviour and a real Mac does not.
 * `TRACETOON_TEST_WORKERS` overrides it if a flake ever shows up.
 */
export function workersFor(
  platform: NodeJS.Platform | string,
  cores: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const forced = Number(env.TRACETOON_TEST_WORKERS);
  if (Number.isInteger(forced) && forced > 0) return forced;
  // Windows is limited by Git process contention, not by cores.
  if (platform === 'win32') return 2;
  if (platform !== 'darwin') return 4;
  return cores >= 8 ? 4 : 1;
}

export const TEST_FILE_WORKERS = workersFor(process.platform, availableParallelism());

const TIMES_FILE = 'node_modules/.cache/tracetoon-test-times.json';
/**
 * Committed per-file times from a Windows CI run, for checkouts without local
 * history (every CI run). Only ordering and shard balance depend on it; when it
 * goes stale, shards are less even, never wrong.
 */
const BASELINE_TIMES_FILE = 'scripts/test-times.baseline.json';
export type TestTimes = Record<string, number>;

function readTimes(path: string): TestTimes {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * How long each test file took on its last passing source run here (untracked),
 * falling back to the committed baseline for files this checkout never ran.
 */
export function readTestTimes(root: string): TestTimes {
  return {
    ...readTimes(join(root, BASELINE_TIMES_FILE)),
    ...readTimes(join(root, TIMES_FILE)),
  };
}

export function writeTestTimes(
  root: string,
  results: { file: string; ms: number; code: number }[],
): void {
  const times = readTimes(join(root, TIMES_FILE));
  // A failed or interrupted file's time is not representative; keep the old one.
  for (const r of results) if (r.code === 0) times[r.file] = r.ms;
  try {
    mkdirSync(join(root, dirname(TIMES_FILE)), { recursive: true });
    writeFileSync(join(root, TIMES_FILE), JSON.stringify(times, null, 1) + '\n');
  } catch {
    /* ordering is an optimization only */
  }
}

/**
 * Longest first. Workers take files in order, and a few end-to-end files take
 * minutes, so alphabetical order could start the slowest file last and leave
 * the other workers idle. Unmeasured files fall back to their size.
 */
export function longestFirst(root: string, files: string[], times: TestTimes): string[] {
  return byCost(root, files, times).map((f) => f.file);
}

function byCost(root: string, files: string[], times: TestTimes) {
  const cost = (file: string) => {
    if (typeof times[file] === 'number') return times[file]!;
    try {
      // About 1ms per byte keeps unmeasured files comparable to measured ones.
      return readFileSync(join(root, file)).length;
    } catch {
      return 0;
    }
  };
  return [...files]
    .map((file) => ({ file, cost: cost(file) }))
    .sort((a, b) => b.cost - a.cost || a.file.localeCompare(b.file));
}

/** `TRACETOON_TEST_SHARD=i/n`: this machine runs the i-th of n shares (1-based). */
export function parseShard(
  value: string | undefined,
): { index: number; count: number } | undefined {
  if (!value?.trim()) return undefined;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value);
  const index = Number(m?.[1]);
  const count = Number(m?.[2]);
  if (!m || count < 1 || index < 1 || index > count)
    throw new Error(`TRACETOON_TEST_SHARD must be i/n with 1 <= i <= n, not "${value}"`);
  return { index, count };
}

/**
 * `TRACETOON_TEST_SHARD_PRELOAD=ms[,ms...]`: work each shard already does
 * outside the source tests, in test-file milliseconds (shard 1 first; missing
 * entries are 0). Every shard must see the same value to agree on the split.
 */
export function parsePreload(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return value.split(',').map((part) => {
    const ms = Number(part.trim() || '0');
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error(
        `TRACETOON_TEST_SHARD_PRELOAD must be comma-separated milliseconds, not "${value}"`,
      );
    return ms;
  });
}

/**
 * One shard's files, longest first. Every file goes, longest first, to the
 * shard with the least total so far (starting from `preload`), so CI machines
 * finish at about the same time and every shard computes the same split from
 * the same inputs.
 */
export function shardFiles(
  root: string,
  files: string[],
  times: TestTimes,
  shard: { index: number; count: number },
  preload: number[] = [],
): string[] {
  const totals = Array.from({ length: shard.count }, (_, i) => preload[i] ?? 0);
  const mine: string[] = [];
  for (const { file, cost } of byCost(root, files, times)) {
    const least = totals.indexOf(Math.min(...totals));
    totals[least]! += cost;
    if (least === shard.index - 1) mine.push(file);
  }
  return mine;
}

export function sourceTestFiles(root: string): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'Cannot discover source tests');
  const files = [
    ...new Set(
      result.stdout
        .split('\0')
        .filter(
          (file) =>
            /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
            !privateRepoPath(file) &&
            !file.split('/').includes('node_modules'),
        ),
    ),
  ].sort();
  if (!files.length) throw new Error('No source test files found');
  return files;
}

/** Bun's end-of-run line, printed once all of a file's tests have finished. */
const SUMMARY = /\bRan \d+ tests? across \d+ files?\./;
/** How long bun may take to exit after the summary before the runner stops waiting. */
const EXIT_GRACE_MS = () => {
  const ms = Number(process.env.TRACETOON_TEST_EXIT_GRACE_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 20_000;
};

/** How long one test file may run before the runner kills it (default 15 minutes). */
const FILE_TIMEOUT_MS = () => {
  const ms = Number(process.env.TRACETOON_TEST_FILE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 15 * 60_000;
};

/** Kill a process and its children (on Windows, `child.kill()` leaves them running). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export async function runTestFiles(options: {
  root: string;
  files: string[];
  args?: string[];
  env?: NodeJS.ProcessEnv;
  workers?: number;
  reports?: string;
  quiet?: boolean;
}) {
  if (
    !options.files.length ||
    !Number.isInteger(options.workers ?? TEST_FILE_WORKERS) ||
    (options.workers ?? TEST_FILE_WORKERS) < 1
  )
    throw new Error('Test execution requires files and a positive worker count');
  let next = 0;
  const logParent = join(options.root, 'node_modules', '.cache', 'test-logs');
  mkdirSync(logParent, { recursive: true });
  const logs = mkdtempSync(join(logParent, 'run-'));
  const results: Array<{ file: string; code: number; ms: number; report?: string }> = [];
  const worker = async () => {
    while (next < options.files.length) {
      const index = next++;
      const file = options.files[index]!;
      const report = options.reports ? join(options.reports, `${index}.xml`) : undefined;
      const started = performance.now();
      const logFile = join(logs, `${index}.log`);
      writeFileSync(logFile, `Test file: ${file}\n`);
      writeFileSync(
        join(logs, 'files.json'),
        JSON.stringify(options.files, null, 2) + '\n',
      );
      const result = await new Promise<{
        file: string;
        code: number;
        ms: number;
        report?: string;
      }>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            'test',
            file,
            // Many tests spawn the CLI (about 10s per call on a Windows runner) or a fake
            // reviewer; Bun's 5s default is far too tight. (bunfig.toml's `timeout` is
            // ignored by Bun 1.3.) A real hang is caught by the per-file watchdog below.
            '--timeout',
            '120000',
            ...(options.args ?? []),
            ...(report ? ['--reporter=junit', '--reporter-outfile', report] : []),
          ],
          {
            cwd: options.root,
            env: options.env ?? process.env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '',
          stderr = '';
        let finishAfterSummary: ReturnType<typeof setTimeout> | undefined;
        const sawSummary = () => {
          if (finishAfterSummary || !SUMMARY.test(stdout + stderr)) return;
          // Bun 1.3 on Windows sometimes does not exit after printing its summary (seen
          // in CI for a different file each time). The file is done: give the process a
          // moment, then kill it and take the result from what it printed.
          finishAfterSummary = setTimeout(() => {
            const text = stdout + stderr;
            const failures = Number(/^\s*(\d+) fail/m.exec(text)?.[1] ?? 1);
            const errors = Number(/^\s*(\d+) errors?\b/m.exec(text)?.[1] ?? 0);
            const note = `\n[test runner] ${file} printed its summary but bun did not exit within ${EXIT_GRACE_MS() / 1000}s; killed it and used the summary.\n`;
            stderr += note;
            appendFileSync(logFile, note);
            killTree(child.pid);
            finish(failures || errors ? 1 : 0);
          }, EXIT_GRACE_MS());
        };
        child.stdout!.on('data', (chunk) => {
          stdout += String(chunk);
          appendFileSync(logFile, chunk);
          sawSummary();
        });
        child.stderr!.on('data', (chunk) => {
          stderr += String(chunk);
          appendFileSync(logFile, chunk);
          sawSummary();
        });
        child.once('error', (error) => {
          stderr += error.message;
        });
        let settled = false;
        const finish = (code: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          clearTimeout(finishAfterSummary);
          // A killed child's pipes can stay open (an orphan holds them); do not let them
          // keep this process alive.
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          if (!options.quiet) {
            process.stdout.write(stdout);
            process.stderr.write(stderr);
          }
          resolve({
            file,
            code,
            ms: Math.round(performance.now() - started),
            report,
          });
        };
        // A file that never finishes (a child that hangs, or an orphan that keeps the
        // pipes open so `close` never fires) must fail with its output so far, not
        // stall the whole job until the CI time limit.
        const limit = FILE_TIMEOUT_MS();
        const watchdog = setTimeout(() => {
          const message = `\n[test runner] ${file} did not finish within ${Math.round(limit / 1000)}s; killing it. The output above is everything it printed.\n`;
          stderr += message;
          appendFileSync(logFile, message);
          killTree(child.pid);
          finish(1);
        }, limit);
        child.once('close', (code) => finish(code ?? 1));
      });
      results[index] = result;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.workers ?? TEST_FILE_WORKERS, options.files.length) },
      worker,
    ),
  );
  writeFileSync(join(logs, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  if (!options.quiet) console.log(`Test logs: ${logs}`);
  return results;
}

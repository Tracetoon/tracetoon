/**
 * One mutating command at a time per run folder. Claude Code moves a long
 * foreground call to the background (after about three minutes, whatever its
 * timeout), and agents then started the same `tracetoon finish` again, so two
 * or three runs rewrote the same digest and render at once.
 *
 * `finish`, `render`, `publish`, `review run`, and `digest`/`prepare`/`context`
 * on an existing run take `run.lock` in the run folder. A second invocation
 * waits for the running one. When it is the same command with the same
 * arguments, it then prints that run's output and exit code instead of
 * running again; another command runs once the lock is free. The lock holder's
 * pid is checked, so a killed command never blocks the run.
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRun, type Run } from '../run.ts';
import { repository } from './state.ts';

const LOCK = 'run.lock';
const RESULT = 'run.lock-result.json';
/** A lock older than this is taken over even if its pid is alive (pid reuse). */
const MAX_AGE_MS = 60 * 60_000;
/** Commands that rewrite the run; the ones that start a new run only with --run. */
const LOCKED = ['finish', 'render', 'publish', 'review run'];
const LOCKED_WITH_RUN = ['digest', 'prepare', 'context'];

export interface LockTarget {
  run: Run;
  command: string;
  /** The exact invocation; only the same one replays a result. */
  key: string;
}

interface Held {
  pid: number;
  command: string;
  key: string;
  startedAt: string;
}

export interface LockResult {
  key: string;
  startedAt: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The run lock this invocation needs, if any. */
export function lockTarget(cwd: string, argv: string[]): LockTarget | undefined {
  const args = argv.slice(2);
  // Commands come first (the only global option, --json, takes no value).
  const words = args.filter((a) => !a.startsWith('-'));
  const first = words[0];
  const command =
    first === 'review' && words[1] === 'run' ? 'review run' : (first ?? '');
  const at = args.findIndex((a) => a === '--run' || a.startsWith('--run='));
  const id =
    at < 0 ? undefined : args[at]!.startsWith('--run=') ? args[at]!.slice(6) : args[at + 1];
  if (!LOCKED.includes(command) && !(LOCKED_WITH_RUN.includes(command) && id)) return undefined;
  if (args.includes('--help') || args.includes('-h')) return undefined;
  try {
    const run = findRun(repository(cwd).gitDir, id);
    return { run, command, key: JSON.stringify(args) };
  } catch {
    return undefined;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    // A zombie (exited, not yet reaped by its parent) still answers signal 0.
    if (process.platform === 'linux')
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) return false;
      } catch {
        /* no procfs entry: trust the signal */
      }
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function readHeld(lock: string): Held | undefined {
  try {
    return JSON.parse(readFileSync(lock, 'utf8')) as Held;
  } catch {
    return undefined;
  }
}

function stale(lock: string, held: Held | undefined): boolean {
  if (!held) {
    // Being written right now, or garbage: give a writer a moment.
    try {
      return Date.now() - statSync(lock).mtimeMs > 5000;
    } catch {
      return true;
    }
  }
  if (held.pid === process.pid) return true;
  if (!alive(held.pid)) return true;
  return Date.now() - Date.parse(held.startedAt) > MAX_AGE_MS;
}

/**
 * Take the run lock, waiting for another holder first. Returns the earlier
 * result to print instead when the holder was this same invocation.
 */
export async function acquireRunLock(
  t: LockTarget,
  notify: (text: string) => void,
): Promise<{ startedAt: string; replay?: LockResult }> {
  const lock = join(t.run.dir, LOCK);
  let told = false;
  for (;;) {
    const startedAt = new Date().toISOString();
    try {
      writeFileSync(
        lock,
        JSON.stringify({ pid: process.pid, command: t.command, key: t.key, startedAt }),
        { flag: 'wx' },
      );
      return { startedAt };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return { startedAt };
    }
    const held = readHeld(lock);
    if (stale(lock, held)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (!held) {
      await Bun.sleep(200);
      continue;
    }
    if (!told) {
      notify(
        `Another \`tracetoon ${held.command}\` is running on this run (pid ${held.pid}); waiting for it here.${held.key === t.key ? ' It is the same command: its result follows.' : ''}\n`,
      );
      told = true;
    }
    while (existsSync(lock) && !stale(lock, readHeld(lock))) {
      const now = readHeld(lock);
      if (now && now.startedAt !== held.startedAt) break;
      await Bun.sleep(1000);
    }
    if (held.key === t.key) {
      const result = readResult(t.run);
      if (result && result.key === t.key && result.startedAt === held.startedAt)
        return { startedAt, replay: result };
    }
  }
}

function readResult(run: Run): LockResult | undefined {
  try {
    return JSON.parse(readFileSync(join(run.dir, RESULT), 'utf8')) as LockResult;
  } catch {
    return undefined;
  }
}

/** Record this invocation's output for a waiting duplicate, and free the run. */
export function releaseRunLock(
  t: LockTarget,
  startedAt: string,
  out: { stdout: string; stderr: string; exitCode: number },
): void {
  try {
    writeFileSync(
      join(t.run.dir, RESULT),
      JSON.stringify({ key: t.key, startedAt, ...out } satisfies LockResult),
    );
  } catch {
    /* the run folder may be gone */
  }
  const lock = join(t.run.dir, LOCK);
  if (readHeld(lock)?.pid === process.pid) rmSync(lock, { force: true });
}

/** Copy everything written to stdout and stderr from now on. */
export function captureOutput(): () => { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const tee = (stream: NodeJS.WriteStream, add: (s: string) => void) => {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') add(chunk);
      else if (chunk instanceof Uint8Array) add(Buffer.from(chunk).toString('utf8'));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
  };
  tee(process.stdout, (s) => (stdout += s));
  tee(process.stderr, (s) => (stderr += s));
  return () => ({ stdout, stderr });
}

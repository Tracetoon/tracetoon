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
 * running again; another command runs once the lock is free.
 *
 * A lock never outlives its holder, on any platform:
 * - the holder removes it when it finishes, and on exit or a signal;
 * - while it holds the lock it listens on a local socket (a Unix socket, a
 *   named pipe on Windows). The kernel closes it the moment the process ends,
 *   even when the process is killed and not yet reaped (a zombie still
 *   answers `kill(pid, 0)`), and a reused pid has no listener. A waiter
 *   that can't connect knows the holder is gone. `kill(pid, 0)` failing
 *   with ESRCH is the quick answer when the pid is free.
 *
 * Children of the holder (TRACETOON_RUN_LOCK names the run folder it holds)
 * never wait for it, so a command that starts other tracetoon commands on the
 * same run can't deadlock.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findRun, type Run } from '../run.ts';
import { repository } from './state.ts';

const LOCK = 'run.lock';
const RESULT = 'run.lock-result.json';
/** Set for a holder's children: the run folder whose lock their parent holds. */
export const HELD_ENV = 'TRACETOON_RUN_LOCK';
/** Commands that rewrite the run; the ones that start a new run only with --run. */
const LOCKED = ['finish', 'render', 'publish', 'review run'];
const LOCKED_WITH_RUN = ['digest', 'prepare', 'context'];
/** A lock file with no listener yet is being set up; after this it is abandoned. */
const SETUP_GRACE_MS = 10_000;

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
  /** Where the holder listens while it holds the lock; null if it couldn't listen. */
  endpoint?: string | null;
}

export interface LockResult {
  key: string;
  startedAt: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The run lock this invocation needs, if any. */
export function lockTarget(
  cwd: string,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): LockTarget | undefined {
  const args = argv.slice(2);
  // Commands come first (the only global option, --json, takes no value).
  const words = args.filter((a) => !a.startsWith('-'));
  const first = words[0];
  const command = first === 'review' && words[1] === 'run' ? 'review run' : (first ?? '');
  const at = args.findIndex((a) => a === '--run' || a.startsWith('--run='));
  const id =
    at < 0 ? undefined : args[at]!.startsWith('--run=') ? args[at]!.slice(6) : args[at + 1];
  if (!LOCKED.includes(command) && !(LOCKED_WITH_RUN.includes(command) && id)) return undefined;
  if (args.includes('--help') || args.includes('-h')) return undefined;
  let run: Run;
  try {
    run = findRun(repository(cwd).gitDir, id);
  } catch {
    return undefined;
  }
  // Started by the command that holds this run's lock: it is waiting for us.
  if (env[HELD_ENV] && resolve(env[HELD_ENV]!) === resolve(run.dir)) return undefined;
  return { run, command, key: JSON.stringify(args) };
}

/** The local socket a holder listens on: short enough for macOS's 104-byte limit. */
function endpointFor(run: Run, startedAt: string): string {
  const id = createHash('sha256')
    .update(`${resolve(run.dir)}\0${process.pid}\0${startedAt}`)
    .digest('hex')
    .slice(0, 20);
  if (process.platform === 'win32') return `\\\\.\\pipe\\tracetoon-${id}`;
  const dir = tmpdir().length < 60 ? tmpdir() : '/tmp';
  return join(dir, `tt-lock-${id}.sock`);
}

function readHeld(lock: string): Held | undefined {
  try {
    return JSON.parse(readFileSync(lock, 'utf8')) as Held;
  } catch {
    return undefined;
  }
}

const ageMs = (file: string) => {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
};

/** Whether a pid is surely gone (ESRCH). EPERM and success mean "maybe alive". */
function pidGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Whether anything listens at the endpoint. Refused or missing means the
 * holder is gone; a timeout or any other error counts as alive, so a platform
 * quirk can only make a waiter wait, never run beside a live holder. (Bun's
 * node:net client is refused by another process's Unix socket; Bun.connect
 * isn't.)
 */
async function listening(endpoint: string, timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(true), timeoutMs);
  });
  const attempt = Bun.connect({
    unix: endpoint,
    socket: { data() {}, open(s) { s.end(); } },
  }).then(
    () => true,
    (e: NodeJS.ErrnoException) =>
      !['ECONNREFUSED', 'ENOENT', 'ENOTSOCK', 'ECONNRESET'].includes(String(e?.code)),
  );
  const alive = await Promise.race([attempt, timeout]);
  clearTimeout(timer);
  return alive;
}

/** Whether the lock's holder is still running. */
async function holderAlive(lock: string, held: Held | undefined): Promise<boolean> {
  if (!held) return ageMs(lock) < SETUP_GRACE_MS; // being written, or garbage
  if (held.pid === process.pid) return false;
  if (pidGone(held.pid)) return false;
  if (held.endpoint) return listening(held.endpoint);
  // No listener recorded: still setting up, or the holder couldn't listen.
  return held.endpoint === undefined ? ageMs(lock) < SETUP_GRACE_MS : true;
}

let server: Server | undefined;
let heldBy: { lock: string; endpoint?: string } | undefined;

/** Remove our lock (and socket file); safe to call more than once, synchronously. */
function dropOurLock(): void {
  if (!heldBy) return;
  const { lock, endpoint } = heldBy;
  heldBy = undefined;
  try {
    server?.close();
  } catch {
    /* closing */
  }
  server = undefined;
  if (readHeld(lock)?.pid === process.pid) rmSync(lock, { force: true });
  if (endpoint && process.platform !== 'win32') rmSync(endpoint, { force: true });
}

let handlersInstalled = false;
function installExitHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', dropOurLock);
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)
    try {
      process.on(signal, () => {
        dropOurLock();
        process.exit(code);
      });
    } catch {
      /* not supported on this platform */
    }
}

/** Listen while holding the lock, and record where; null when listening fails. */
async function listen(endpoint: string): Promise<string | null> {
  if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  // Let the prober close the connection: destroying it at once can make the
  // prober's connect fail ("Failed to connect") before it sees the connection.
  const s = createServer((c) => {
    c.on('error', () => {});
    c.on('end', () => c.end());
    setTimeout(() => c.destroy(), 5000).unref?.();
  });
  const ok = await new Promise<boolean>((done) => {
    s.once('error', () => done(false));
    s.listen(endpoint, () => done(true));
  });
  if (!ok) return null;
  s.on('error', () => {});
  // Not unref()ed: Bun stops accepting on an unref()ed server; the holder closes it on release.
  server = s;
  return endpoint;
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
    const mine: Held = { pid: process.pid, command: t.command, key: t.key, startedAt };
    try {
      writeFileSync(lock, JSON.stringify(mine), { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return { startedAt };
      const held = readHeld(lock);
      if (!(await holderAlive(lock, held))) {
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
      for (;;) {
        await Bun.sleep(1000);
        if (!existsSync(lock)) break;
        const now = readHeld(lock);
        if (now && now.startedAt !== held.startedAt) break;
        if (!(await holderAlive(lock, now ?? held))) break;
      }
      if (held.key === t.key) {
        const result = readResult(t.run);
        if (result && result.key === t.key && result.startedAt === held.startedAt)
          return { startedAt, replay: result };
      }
      continue;
    }
    // Ours: listen, so waiters can tell we're alive, and clean up however we end.
    heldBy = { lock };
    installExitHandlers();
    const endpoint = await listen(endpointFor(t.run, startedAt));
    heldBy = { lock, ...(endpoint ? { endpoint } : {}) };
    writeFileSync(lock, JSON.stringify({ ...mine, endpoint }));
    process.env[HELD_ENV] = t.run.dir;
    return { startedAt };
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
  dropOurLock();
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

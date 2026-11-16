import { spawnSync } from 'node:child_process';
import { count, measured } from './profile.ts';

export interface ExecResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a program without a shell. Never throws; a missing program gives ok=false. */
export function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    input?: string | Uint8Array;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): ExecResult {
  const kind = /(?:^|[\\/])git(?:\.exe)?$/i.test(cmd)
    ? 'git'
    : /(?:^|[\\/])gh(?:\.exe)?$/i.test(cmd)
      ? 'github'
      : 'other';
  // Any program but a read-only git query may change a repository.
  if (kind !== 'git' || gitEffect(args) === 'write') forgetGitAnswers();
  count(`subprocess.${kind}`);
  const r = measured(`subprocess.${kind}`, () =>
    spawnSync(cmd, args, {
      cwd: opts.cwd,
      input: opts.input,
      env: opts.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      timeout: opts.timeoutMs,
    }),
  );
  if (r.error)
    return { ok: false, code: -1, stdout: '', stderr: String(r.error.message) };
  return {
    ok: r.status === 0,
    code: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/**
 * Within one hook event or one CLI command, the same few git questions (top
 * level, branch, origin URL, a config value) are asked many times, and each
 * answer costs a process start (about 0.1s on Windows). Inside withGitAnswers,
 * those answers are reused until anything that may change a repository runs:
 * a git command outside the read-only list, any other program, or an explicit
 * forgetGitAnswers(). Outside a scope nothing is cached.
 */
let scopes = 0;
const answers = new Map<string, ExecResult>();

export function withGitAnswers<T>(action: () => T): T {
  scopes++;
  let pending = false;
  try {
    const result = action();
    if (result instanceof Promise) {
      pending = true;
      return result.finally(leave) as T;
    }
    return result;
  } finally {
    if (!pending) leave();
  }
}

function leave() {
  if (--scopes === 0) answers.clear();
}

/** Drop reused answers: something outside git() may have changed a repository. */
export function forgetGitAnswers() {
  answers.clear();
}

/** Subcommands that never change refs, the index, config or the work tree. */
const READ_ONLY = new Set([
  'blame',
  'cat-file',
  'check-ignore',
  'describe',
  'diff',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'merge-base',
  'rev-list',
  'rev-parse',
  'show',
  'show-ref',
  'status',
]);

/** The subcommand and its arguments, after git's own leading options. */
function subcommand(args: readonly string[]): readonly string[] {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-'))
    i += args[i] === '-c' || args[i] === '-C' ? 2 : 1;
  return args.slice(i);
}

/** 'cache': safe to reuse within a scope; 'read': changes nothing; 'write': may change a repository. */
function gitEffect(args: readonly string[]): 'cache' | 'read' | 'write' {
  const [sub, ...rest] = subcommand(args);
  if (sub === 'rev-parse') return 'cache';
  if (sub === 'remote')
    return rest[0] === 'get-url' || (rest[0] === '-v' && rest.length === 1)
      ? 'cache'
      : 'write';
  if (sub === 'config')
    return rest[0] === '--get' && rest.length === 2 ? 'cache' : 'write';
  if (sub === 'worktree') return rest[0] === 'list' ? 'read' : 'write';
  if (sub === 'notes')
    return rest.find((a) => !a.startsWith('-')) === 'list' ? 'read' : 'write';
  return sub && READ_ONLY.has(sub) ? 'read' : 'write';
}

/** Git with the same hardening Showtail uses: no fsmonitor, no ext protocol. */
export function git(
  cwd: string,
  args: string[],
  input?: string | Uint8Array,
  env?: NodeJS.ProcessEnv,
): ExecResult {
  const reusable =
    scopes > 0 && input === undefined && !env && gitEffect(args) === 'cache';
  const key = reusable ? JSON.stringify([cwd, args]) : '';
  const known = reusable ? answers.get(key) : undefined;
  if (known) return { ...known };
  const result = run(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'core.quotepath=off',
      ...args,
    ],
    { cwd, input, env: env ? { ...process.env, ...env } : undefined },
  );
  if (reusable) answers.set(key, { ...result });
  return result;
}

export function gh(cwd: string, args: string[]): ExecResult {
  // Tests point this at a script that stands in for the GitHub CLI.
  const fake = process.env.TRACETOON_GH_SCRIPT;
  const [cmd, argv] = fake
    ? [process.env.TRACETOON_TEST_RUNNER ?? process.execPath, [fake, ...args]]
    : ['gh', args];
  return run(cmd, argv, {
    cwd,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
  });
}

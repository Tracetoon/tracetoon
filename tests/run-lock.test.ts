import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from '../src/util/exec.ts';
import { HELD_ENV, lockTarget } from '../src/workflow/runLock.ts';
import { makeRepo, tempDir } from './helpers.ts';

setDefaultTimeout(120_000);
const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
/** The source, the bundle (TRACETOON_TEST_CLI) or a compiled binary (TRACETOON_TEST_BINARY). */
const PROGRAM = process.env.TRACETOON_TEST_BINARY
  ? [process.env.TRACETOON_TEST_BINARY]
  : [process.execPath, CLI];

function setup() {
  const scratch = tempDir('tracetoon-lock-');
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: tempDir('tracetoon-claude-'),
    CODEX_HOME: tempDir('tracetoon-codex-'),
    GEMINI_HOME: tempDir('tracetoon-gemini-'),
    TRACETOON_CONFIG: join(scratch, 'config.json'),
    TRACETOON_CODEX_BIN: 'none',
    TRACETOON_AGY_BIN: 'none',
  };
  const cli = (cwd: string, ...args: string[]) => {
    const started = Date.now();
    const r = spawnSync(PROGRAM[0]!, [...PROGRAM.slice(1), ...args], { cwd, env, encoding: 'utf8' });
    let json: any;
    try {
      json = JSON.parse(r.stdout);
    } catch {
      /* text */
    }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
  };
  return { cli };
}

const HOLDER = resolve(import.meta.dir, 'lock-holder.ts');

/** A real holder process (tests/lock-holder.ts); resolves once it listens. */
async function holder(dir: string, command: string, args: string[], ms: number, stdout = '') {
  const child = spawn(
    process.execPath,
    [HOLDER, dir, command, JSON.stringify(args), String(ms), stdout],
    { stdio: 'ignore' },
  );
  const lock = join(dir, 'run.lock');
  for (let i = 0; i < 200; i++) {
    try {
      if (JSON.parse(readFileSync(lock, 'utf8')).endpoint) return child;
    } catch {
      /* not yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('the holder never took the lock');
}

describe('run folder lock', () => {
  function preparedRun() {
    const { cli } = setup();
    const repo = makeRepo();
    repo.commit('src/a.ts', 'export const a = 1;\n', 'feat: a');
    const d = cli(repo.root, '--json', 'digest', '--offline');
    expect(d.code).toBe(0);
    expect(cli(repo.root, '--json', 'context', '--run', d.json.run, '--offline').code).toBe(0);
    return { cli, repo, run: d.json.run as string, dir: d.json.runDir as string };
  }

  // The CLI calls below block this test process, so a holder that exits meanwhile
  // stays an unreaped zombie (its pid still answers kill 0): the waiter must
  // still see it's gone, on every platform.
  test('the same command waits for the running one and prints its result', async () => {
    const { cli, repo, run, dir } = preparedRun();
    const args = ['render', '--run', run];
    await holder(dir, 'render', args, 2500, 'RENDERED BY THE FIRST ONE\n');
    const r = cli(repo.root, ...args);
    expect(r.stderr).toContain('Another `tracetoon render` is running on this run');
    expect(r.stdout).toBe('RENDERED BY THE FIRST ONE\n');
    expect(r.code).toBe(0);
    expect(r.ms).toBeGreaterThan(1000);
  });

  test('a different command waits, then runs itself and frees the run', async () => {
    const { cli, repo, run, dir } = preparedRun();
    await holder(dir, 'finish', ['finish', '--run', run], 2500);
    const r = cli(repo.root, '--json', 'render', '--run', run);
    expect(r.stderr).toContain('Another `tracetoon finish` is running on this run');
    expect(r.ms).toBeGreaterThan(1000);
    // It ran (no body.md yet, so it says what to write) and left no lock behind.
    expect(r.json.error).toContain('body.md');
    expect(existsSync(join(dir, 'run.lock'))).toBe(false);
    const result = JSON.parse(readFileSync(join(dir, 'run.lock-result.json'), 'utf8'));
    expect(result.key).toBe(JSON.stringify(['--json', 'render', '--run', run]));
    expect(result.exitCode).toBe(r.code);
  });

  test('a holder killed outright (no cleanup, not reaped) frees the run at once', async () => {
    const { cli, repo, run, dir } = preparedRun();
    const child = await holder(dir, 'finish', ['finish', '--run', run], 600_000);
    child.kill('SIGKILL');
    const r = cli(repo.root, '--json', 'render', '--run', run);
    expect(r.ms).toBeLessThan(20_000);
    expect(r.json.error).toContain('body.md');
    expect(existsSync(join(dir, 'run.lock'))).toBe(false);
  });

  test("a lock whose pid is gone is taken over at once", () => {
    const { cli, repo, run, dir } = preparedRun();
    const gone = spawnSync(process.execPath, ['-e', '0']).pid!;
    writeFileSync(
      join(dir, 'run.lock'),
      JSON.stringify({
        pid: gone,
        command: 'finish',
        key: '[]',
        startedAt: new Date().toISOString(),
        endpoint: null,
      }),
    );
    const r = cli(repo.root, '--json', 'render', '--run', run);
    expect(r.stderr).not.toContain('Another');
    expect(r.json.error).toContain('body.md');
  });

  test("the holder's own children never wait for it", () => {
    const { repo, run, dir } = preparedRun();
    const argv = ['bun', 'cli.ts', 'render', '--run', run];
    expect(lockTarget(repo.root, argv, {})?.command).toBe('render');
    expect(lockTarget(repo.root, argv, { [HELD_ENV]: dir })).toBeUndefined();
    expect(lockTarget(repo.root, ['bun', 'cli.ts', 'query', 'brief', '--run', run], {})).toBeUndefined();
    expect(lockTarget(repo.root, ['bun', 'cli.ts', 'digest', '--offline'], {})).toBeUndefined();
  });
});

describe('a refresh keeps the base the run was prepared with', () => {
  test('digest --run without --base reuses it (offline, the default base may be stale)', () => {
    const { cli } = setup();
    const repo = makeRepo();
    repo.commit('src/a.ts', 'export const a = 1;\n', 'feat: a');
    // dev already has a.ts; the PR against dev adds only b.ts.
    expect(git(repo.root, ['branch', 'dev']).ok).toBe(true);
    repo.commit('src/b.ts', 'export const b = 2;\n', 'feat: b');
    const first = cli(repo.root, '--json', 'digest', '--offline', '--base', 'dev');
    expect(first.code).toBe(0);
    const run = first.json.run as string;
    const dir = first.json.runDir as string;
    const files = () => {
      expect(cli(repo.root, '--json', 'context', '--run', run, '--offline').code).toBe(0);
      return readFileSync(join(dir, 'changes.patch'), 'utf8').match(/^\+\+\+ b\/\S+/gm);
    };
    expect(files()).toEqual(['+++ b/src/b.ts']);
    const again = cli(repo.root, '--json', 'digest', '--run', run, '--offline');
    expect(again.code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'digest.json'), 'utf8')).pr.base).toBe('dev');
    expect(files()).toEqual(['+++ b/src/b.ts']);
  });
});

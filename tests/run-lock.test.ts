import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from '../src/util/exec.ts';
import { makeRepo, tempDir } from './helpers.ts';

setDefaultTimeout(120_000);
const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');

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
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
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

/** A live process holding the lock for about `ms`. */
function holder(ms: number) {
  const child = spawn(process.execPath, ['-e', `await Bun.sleep(${ms})`], { stdio: 'ignore' });
  return child.pid!;
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

  test('the same command waits for the running one and prints its result', () => {
    const { cli, repo, run, dir } = preparedRun();
    const args = ['render', '--run', run];
    const startedAt = new Date().toISOString();
    const pid = holder(2500);
    writeFileSync(
      join(dir, 'run.lock'),
      JSON.stringify({ pid, command: 'render', key: JSON.stringify(args), startedAt }),
    );
    writeFileSync(
      join(dir, 'run.lock-result.json'),
      JSON.stringify({
        key: JSON.stringify(args),
        startedAt,
        stdout: 'RENDERED BY THE FIRST ONE\n',
        stderr: '',
        exitCode: 0,
      }),
    );
    const r = cli(repo.root, ...args);
    expect(r.stderr).toContain('Another `tracetoon render` is running on this run');
    expect(r.stdout).toBe('RENDERED BY THE FIRST ONE\n');
    expect(r.code).toBe(0);
    expect(r.ms).toBeGreaterThan(1500);
  });

  test('a different command waits, then runs itself and frees the run', () => {
    const { cli, repo, run, dir } = preparedRun();
    const pid = holder(2500);
    writeFileSync(
      join(dir, 'run.lock'),
      JSON.stringify({
        pid,
        command: 'finish',
        key: JSON.stringify(['finish', '--run', run]),
        startedAt: new Date().toISOString(),
      }),
    );
    const r = cli(repo.root, '--json', 'render', '--run', run);
    expect(r.stderr).toContain('Another `tracetoon finish` is running on this run');
    expect(r.ms).toBeGreaterThan(1500);
    // It ran (no body.md yet, so it says what to write) and left no lock behind.
    expect(r.json.error).toContain('body.md');
    expect(existsSync(join(dir, 'run.lock'))).toBe(false);
    const result = JSON.parse(readFileSync(join(dir, 'run.lock-result.json'), 'utf8'));
    expect(result.key).toBe(JSON.stringify(['--json', 'render', '--run', run]));
    expect(result.exitCode).toBe(r.code);
  });

  test("a dead holder's lock is taken over at once", () => {
    const { cli, repo, run, dir } = preparedRun();
    writeFileSync(
      join(dir, 'run.lock'),
      JSON.stringify({
        pid: 2 ** 22 + 12345,
        command: 'finish',
        key: '[]',
        startedAt: new Date().toISOString(),
      }),
    );
    const r = cli(repo.root, '--json', 'render', '--run', run);
    expect(r.stderr).not.toContain('Another');
    expect(r.json.error).toContain('body.md');
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

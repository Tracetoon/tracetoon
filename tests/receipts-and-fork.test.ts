import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prHead } from '../src/commands/publish.ts';
import {
  checkEnvironment,
  checkReceiptGap,
  checkSummary,
  declaredChecks,
  setupFailure,
} from '../src/workflow/checks.ts';
import { validationSection } from '../src/graph/briefRender.ts';
import { makeRepo, tempDir } from './helpers.ts';

const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');

describe('PR head from a fork', () => {
  test('a fork names its owner; the base repo itself uses the bare branch', () => {
    expect(prHead('feat/x', 'octo', 'acme/demo')).toBe('octo:feat/x');
    expect(prHead('feat/x', 'Acme', 'acme/demo')).toBe('feat/x');
    // Unknown origin or base repo: no guess.
    expect(prHead('feat/x', undefined, 'acme/demo')).toBe('feat/x');
    expect(prHead('feat/x', 'octo', undefined)).toBe('feat/x');
  });
});

describe('check summaries', () => {
  test("a wrapper's total on stdout beats the last child's per-file lines on stderr", () => {
    const stderr =
      ' 5 pass\n 0 fail\nRan 5 tests across 1 file.\n 2 pass\n 0 fail\nRan 2 tests across 1 file.\n';
    const stdout = 'Source test files: 46 passed, 0 failed.\n';
    expect(checkSummary(stdout, stderr).at(-1)).toBe(
      'Source test files: 46 passed, 0 failed.',
    );
  });
  test('one stream keeps its last three result lines', () => {
    expect(
      checkSummary(
        '',
        ' 697 pass\n 0 fail\n 3384 expect() calls\nRan 697 tests across 46 files.\n',
      ),
    ).toEqual([' 697 pass', ' 0 fail', 'Ran 697 tests across 46 files.']);
    expect(checkSummary('12 passed, 1 failed\n', '')).toEqual(['12 passed, 1 failed']);
  });
});

describe('several suites and setup failures', () => {
  const suite = (n: number) =>
    ` ${n} pass\n 0 fail\nRan ${n} tests across 1 file. [1.2s]\n`;

  test('several suites in one output: only the aggregate after them, or no count', () => {
    expect(
      checkSummary(`${suite(5)}${suite(7)}All suites: 12 passed, 0 failed\n`, ''),
    ).toEqual(['All suites: 12 passed, 0 failed']);
    // No aggregate: the last suite's numbers are not the run's.
    expect(checkSummary(`${suite(5)}${suite(7)}`, '')).toEqual([]);
    expect(
      checkSummary(
        'test result: ok. 3 passed; 0 failed\ntest result: ok. 9 passed; 0 failed\n',
        '',
      ),
    ).toEqual([]);
    // One suite keeps its lines.
    expect(checkSummary(suite(5), '')).toHaveLength(3);
  });

  test('a check that stops before any result for want of a tool or network', () => {
    expect(setupFailure('', 'sh: 1: cargo: not found\n', 127)).toBe(
      'sh: 1: cargo: not found',
    );
    expect(setupFailure('', 'bash: line 1: mytool: command not found\n', 127)).toBe(
      'bash: line 1: mytool: command not found',
    );
    expect(
      setupFailure(
        '',
        'error: failed to download from registry: Could not resolve host\n',
        1,
      ),
    ).toBe('failed to download from registry: Could not resolve host');
    const enoent = Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' });
    expect(setupFailure('', '', null, enoent)).toBe('the command was not found');
    // A check that ran and failed is a failure, whatever else it printed.
    expect(
      setupFailure(' 3 pass\n 1 fail\n', 'ECONNREFUSED in a test\n', 1),
    ).toBeUndefined();
    expect(setupFailure('', 'src/a.ts(3,1): error TS2304\n', 2)).toBeUndefined();
  });

  test('tests that could not load a dependency could not run here, whatever counts they printed', () => {
    expect(
      setupFailure(
        ' 0 pass\n 3 fail\nRan 3 tests across 3 files.\n',
        "error: Cannot find module 'zod' from '<repo>/src/a.ts'\n",
        1,
      ),
    ).toBe("Cannot find module 'zod' from '<repo>/src/a.ts'");
    expect(
      setupFailure(
        '180 passed, 52 failed\n',
        "ModuleNotFoundError: No module named 'requests'\n",
        1,
      ),
    ).toBe("ModuleNotFoundError: No module named 'requests'");
    expect(
      setupFailure(' 4 pass\n 1 fail\n', 'getaddrinfo ENOTFOUND registry.npmjs.org\n', 1),
    ).toBe('getaddrinfo ENOTFOUND registry.npmjs.org');
    // The code's own import (a relative path) failing is a real failure.
    expect(
      setupFailure(' 0 pass\n 1 fail\n', "error: Cannot find module './gone.ts'\n", 1),
    ).toBeUndefined();
    expect(setupFailure('', "Cannot find package '@scope/pkg'\n", 1)).toBe(
      "Cannot find package '@scope/pkg'",
    );
  });

  test('render says it could not run here, and leaves its kind to the session logs', () => {
    const section = validationSection({
      unchecked: [],
      sections: [
        {
          title: 'validation',
          columns: [],
          rows: [
            {
              check: 'V1',
              kind: 'test',
              outcome: 'failed',
              result: 'could not run here: sh: 1: cargo: not found',
              when: 'fresh: run on the submitted content',
              editedAfter: [],
              cmd: 'cargo test',
            },
            {
              check: 'R4',
              kind: 'test',
              outcome: 'passed',
              result: '3 passed; 0 failed',
              when: 'after the last edit the logs captured',
              editedAfter: [],
              cmd: 'cargo test',
            },
          ],
        },
      ],
    });
    const lines = section.split('\n').filter((l) => l.startsWith('- '));
    expect(lines[0]).toBe(
      '- `cargo test`: could not run in this environment (sh: 1: cargo: not found); `tracetoon check` got no result on the code.',
    );
    expect(section).not.toContain('on the submitted content.');
    expect(lines[1]).toBe(
      '- `cargo test`: passed (3 passed, 0 failed) in the session logs.',
    );
  });
});

describe('check environment identity', () => {
  test('temp-directory and terminal variables do not change it; PATH does', () => {
    const base = { PATH: '/usr/bin', HOME: '/home/u' };
    expect(
      checkEnvironment({ ...base, TMPDIR: '/var/tmp/a', TERM: 'xterm', COLUMNS: '80' }),
    ).toBe(checkEnvironment({ ...base, TMPDIR: '/tmp', TERM: 'tmux-256color' }));
    expect(checkEnvironment({ ...base, PATH: '/opt/bin:/usr/bin' })).not.toBe(
      checkEnvironment(base),
    );
  });
});

describe('receipts without task bookkeeping', () => {
  test('digest reads tracetoon check receipts for a run started by digest alone', () => {
    const repo = makeRepo();
    const scratch = tempDir('tracetoon-env-');
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: tempDir('tracetoon-claude-'),
      CODEX_HOME: tempDir('tracetoon-codex-'),
      ANTIGRAVITY_HOME: tempDir('tracetoon-gemini-'),
      GEMINI_HOME: tempDir('tracetoon-gemini-'),
      TRACETOON_CONFIG: join(scratch, 'config.json'),
      TRACETOON_GH_SCRIPT: resolve(import.meta.dir, 'fake-gh.ts'),
    };
    const cli = (...args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, '--json', ...args], {
        cwd: repo.root,
        env,
        encoding: 'utf8',
      });
      return { code: r.status, json: JSON.parse(r.stdout || 'null'), stderr: r.stderr };
    };
    const first = cli('digest');
    expect(first.code).toBe(0);
    const run = first.json.run as string;
    const check = cli(
      'check',
      '--run',
      run,
      '--name',
      'unit',
      '--',
      process.execPath,
      '-e',
      'console.log("3 pass")',
    );
    expect(check.code).toBe(0);
    const again = cli('digest', '--run', run);
    expect(again.code).toBe(0);
    const digest = JSON.parse(
      readFileSync(join(again.json.runDir ?? first.json.runDir, 'digest.json'), 'utf8'),
    );
    expect(digest.verification).toEqual([
      expect.objectContaining({ id: 'V1', outcome: 'passed', summary: ['3 pass'] }),
    ]);
  });
});

describe('declared repository checks need a receipt or a recorded skip', () => {
  test('package.json check scripts are found; a placeholder test script is not', () => {
    const root = tempDir('declared');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'bun test', typecheck: 'tsc', build: 'x' } }),
    );
    expect(declaredChecks(root)).toEqual(['npm run test', 'npm run typecheck']);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    expect(declaredChecks(root)).toEqual([]);
  });
  test('the gap closes once any receipt (a pass, a failure or a skip) exists', () => {
    const root = tempDir('declared-gap');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 't' } }));
    const dir = join(root, 'run');
    mkdirSync(dir, { recursive: true });
    const run = { id: 'r1', dir } as any;
    expect(checkReceiptGap(run, root)).toContain('no chained');
    writeFileSync(join(dir, 'checks.json'), JSON.stringify([{ v: 1, outcome: 'not-run' }]));
    expect(checkReceiptGap(run, root)).toBeUndefined();
  });
});

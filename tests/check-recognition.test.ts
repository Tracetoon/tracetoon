import { describe, expect, test } from 'bun:test';
import {
  checkForm,
  commandRun,
  commandRuns,
  isTestCommand,
  isTestScript,
  verificationSegment,
} from '../src/digest/build.ts';
import { parseCodexLines } from '../src/trace/codex.ts';
import { parseClaudeLines } from '../src/trace/claude.ts';
import { leadingCd, runsInRepo } from '../src/trace/pathMatch.ts';
import { ORPHAN_COMMAND, type TraceSession } from '../src/trace/types.ts';

const kindOf = (cmd: string) => verificationSegment(cmd)?.kind;

describe('check commands as agents write them', () => {
  test('path prefixes, launchers, pinned versions and assignments are seen through', () => {
    expect(checkForm('./node_modules/.bin/tsc --noEmit')).toBe('tsc --noEmit');
    expect(checkForm('node_modules/.bin/eslint src')).toBe('eslint src');
    expect(checkForm('/home/u/.cargo/bin/cargo test')).toBe('cargo test');
    expect(checkForm('npx --yes bun@1.4.0 test')).toBe('bun test');
    expect(checkForm('npx -y @biomejs/biome@1.9.0 check .')).toBe(
      '@biomejs/biome check .',
    );
    expect(kindOf('npx -y @biomejs/biome@1.9.0 check .')).toBe('lint');
    expect(checkForm('CI=1 env FOO=bar pnpm exec vitest run')).toBe('vitest run');
    expect(checkForm('uv run pytest -q')).toBe('pytest -q');
    expect(checkForm('poetry run mypy src')).toBe('mypy src');
    expect(kindOf('./node_modules/.bin/tsc --noEmit')).toBe('typecheck');
    expect(kindOf('npx --yes bun@1.4.0 test')).toBe('test');
    expect(kindOf('ENV=x /home/u/.cargo/bin/cargo test -- --test-threads=1')).toBe(
      'test',
    );
    expect(kindOf('bunx tsc -p .')).toBe('typecheck');
    expect(kindOf('yarn tsc')).toBe('typecheck');
    expect(kindOf('uv run pytest')).toBe('test');
    expect(kindOf('poetry run pytest tests/')).toBe('test');
  });

  test('package scripts that check, test, lint or typecheck', () => {
    expect(kindOf('PATH=/x:$PATH bun run check')).toBe('test');
    expect(kindOf('npm run verify')).toBe('test');
    expect(kindOf('pnpm run test:unit')).toBe('test');
    expect(kindOf('yarn run lint:ci')).toBe('lint');
    expect(kindOf('bun run typecheck')).toBe('typecheck');
    expect(kindOf('npm run format:check')).toBe('lint');
    // Not checks: building, starting or formatting in place.
    expect(kindOf('bun run dev')).toBeUndefined();
    expect(kindOf('npm run checkout-docs')).toBeUndefined();
    expect(kindOf('npm ci')).toBeUndefined();
    expect(kindOf('bun ci')).toBeUndefined();
    expect(kindOf('npm run ci')).toBe('test');
  });

  test('shell linters, syntax checks and whitespace checks are lint runs', () => {
    expect(kindOf('shellcheck install.sh')).toBe('lint');
    expect(kindOf('sh -n install.sh')).toBe('lint');
    expect(kindOf('bash -n bin/tool && echo ok')).toBe('lint');
    expect(kindOf('shfmt -d bin/tool')).toBe('lint');
    expect(kindOf('shfmt -ln bash -d bin/tool')).toBe('lint');
    expect(kindOf('git diff --check')).toBe('lint');
    expect(kindOf('git -C ../repo diff --cached --check')).toBe('lint');
    expect(kindOf('node --check dist/x.mjs')).toBe('lint');
    expect(kindOf('cargo fmt --check')).toBe('lint');
    // Writing or reading, not checking.
    expect(kindOf('shfmt -w bin/tool')).toBeUndefined();
    expect(kindOf('git diff --stat')).toBeUndefined();
    expect(kindOf('bash -lc "echo hi"')).toBeUndefined();
  });

  test('test and smoke scripts, by a shell or interpreter or by path', () => {
    for (const cmd of [
      'sh dev/test-install.sh',
      'bash -e tests/run.sh',
      './scripts/smoke-test.sh',
      'tests/e2e/run.sh --fast',
      'python3 tests/check_cli.py',
      'bun run scripts/test-source.ts',
      './run_tests.sh',
    ])
      expect([cmd, isTestCommand(cmd)]).toEqual([cmd, true]);
    for (const cmd of [
      'cat tests/x.sh',
      'chmod +x dev/test-install.sh',
      'ls tests/',
      'vim test.sh',
      'node scripts/latest.js',
      'sh scripts/contest.sh',
      './target/debug/pingpong 10',
    ])
      expect([cmd, isTestCommand(cmd)]).toEqual([cmd, false]);
    // A shell's -n only parses the script: a syntax check, not a test run.
    expect(isTestScript('bash -n tests/run.sh')).toBe(false);
    expect(kindOf('bash -n tests/run.sh')).toBe('lint');
  });

  test('a silent lint or typecheck with a clean exit passes, said as such', () => {
    expect(commandRun('shellcheck a.sh', false, '')).toMatchObject({
      outcome: 'passed',
      basis: 'exit status',
      summary: ['exit 0, no output'],
    });
    // Headers an agent wraps around the output are not output.
    expect(
      commandRun(
        './node_modules/.bin/tsc --noEmit',
        false,
        'Chunk ID: 1\nWall time: 2.1 seconds\nProcess exited with code 0\nOutput:\n',
      )?.summary,
    ).toEqual(['exit 0, no output']);
    expect(commandRun('bash -n x.sh', false, 'warning: something')?.summary).toEqual([
      'exit 0',
    ]);
    // A failing exit is still a failure; a masked status is still unknown.
    expect(commandRun('shellcheck a.sh', true, 'SC2086')?.outcome).toBe('failed');
    expect(commandRun('bun x tsc --noEmit | tail -3', false, '')?.outcome).toBe(
      'unknown',
    );
    // Chained: each check is its own run.
    expect(
      commandRuns(
        'sh -n install.sh && shellcheck install.sh && sh dev/test-install.sh',
        false,
        '26 passed',
      ).map((r) => [r.kind, r.outcome]),
    ).toEqual([
      ['lint', 'passed'],
      ['lint', 'passed'],
      ['test', 'passed'],
    ]);
  });
});

describe("runs are this repository's", () => {
  const roots = ['/w/app', '/w/app-wt'];
  test('a run in another folder is not; unsure means it is', () => {
    expect(runsInRepo('bun test', '/w/app/src', roots)).toBe(true);
    expect(runsInRepo('bun test', '/w/app-wt', roots)).toBe(true);
    expect(runsInRepo('cd ../other && bun run test', '/w/app', roots)).toBe(false);
    expect(runsInRepo('bun run test', '/w/other', roots)).toBe(false);
    // A folder holding the repo, no folder, or a command naming the repo: kept.
    expect(runsInRepo('bun test', '/w', roots)).toBe(true);
    expect(runsInRepo('bun test', undefined, roots)).toBe(true);
    expect(runsInRepo('bun test /w/app/tests', '/tmp', roots)).toBe(true);
  });

  test('git -C and chained cd move the run; a relative folder is unknown', () => {
    expect(runsInRepo('git -C ../site diff --check', '/w/app', roots)).toBe(false);
    expect(runsInRepo('git -C /w/app-wt diff --check', '/tmp', roots)).toBe(true);
    expect(runsInRepo('cd /w && cd other && bun test', '/w/app', roots)).toBe(false);
    expect(runsInRepo('cd /w; cd app && bun test', '/tmp', roots)).toBe(true);
    expect(leadingCd('git -C sub status', '/w/app')).toBe('/w/app/sub');
    // A folder relative to nothing known can't be placed: kept.
    expect(runsInRepo('bun test', 'some/dir', roots)).toBe(true);
    expect(runsInRepo('cd ../x && bun test', 'rel', roots)).toBe(true);
    expect(runsInRepo('cd ../x && bun test', undefined, roots)).toBe(true);
  });
});

const session = (agent: TraceSession['agent'] = 'codex'): TraceSession => ({
  agent,
  sessionId: 's',
  source: 'x',
  records: [],
  unknownTypes: {},
  warnings: [],
});
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n');
const T = (n: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, n)).toISOString();

describe('Codex unified exec', () => {
  const call = (n: number, id: string, name: string, args: unknown) => ({
    timestamp: T(n),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name,
      call_id: id,
      arguments: JSON.stringify(args),
    },
  });
  const output = (n: number, id: string, out: string) => ({
    timestamp: T(n),
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: id, output: out },
  });

  test('a file:// working directory is the path it names', () => {
    const s = session();
    parseCodexLines(
      jsonl([
        {
          timestamp: T(0),
          type: 'session_meta',
          payload: { id: 's', cwd: 'file:///w/app' },
        },
        call(1, 'c1', 'exec_command', {
          cmd: 'bun test',
          workdir: 'file:///w/other%20repo',
        }),
        output(2, 'c1', 'Process exited with code 0\nOutput:\n1 pass\n'),
        call(3, 'c2', 'exec_command', { cmd: 'bun test' }),
        output(4, 'c2', 'Process exited with code 0\nOutput:\n1 pass\n'),
      ]),
      s,
    );
    expect(s.records.filter((r) => r.kind === 'command').map((r) => r.cwd)).toEqual([
      '/w/other repo',
      '/w/app',
    ]);
  });

  test('exec_command calls are commands, with their workdir, exit code and output', () => {
    const s = session();
    parseCodexLines(
      jsonl([
        { timestamp: T(0), type: 'session_meta', payload: { id: 's', cwd: '/home/u' } },
        call(1, 'c1', 'exec_command', { cmd: 'bash -n bin/tool', workdir: '/repo' }),
        output(
          2,
          'c1',
          'Chunk ID: a1\nWall time: 0.01 seconds\nProcess exited with code 0\nOriginal token count: 0\nOutput:\n',
        ),
        call(3, 'c2', 'exec_command', { cmd: 'sh tests/smoke.sh', workdir: '/repo' }),
        output(
          4,
          'c2',
          'Chunk ID: a2\nWall time: 1 seconds\nProcess running with session ID 7\nOutput:\nstarting\n',
        ),
        call(5, 'c3', 'write_stdin', { session_id: 7, chars: '' }),
        output(
          6,
          'c3',
          'Chunk ID: a3\nWall time: 3 seconds\nProcess exited with code 1\nOutput:\n1 failed\n',
        ),
      ]),
      s,
    );
    const cmds = s.records.filter((r) => r.kind === 'command');
    expect(cmds).toMatchObject([
      { cmd: 'bash -n bin/tool', isError: false, cwd: '/repo', ts: T(1) },
      { cmd: 'sh tests/smoke.sh', isError: true, cwd: '/repo', ts: T(3) },
    ]);
    const [syntax, smoke] = cmds as { output?: string }[];
    expect(syntax!.output?.trim()).toBe('');
    expect(smoke!.output).toContain('starting');
    expect(smoke!.output).toContain('1 failed');
    expect(commandRun('bash -n bin/tool', false, syntax!.output)?.summary).toEqual([
      'exit 0, no output',
    ]);
  });
});

describe('Claude Code results whose call is not in the log', () => {
  const result = (id: string, stdout: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'user',
      timestamp: T(5),
      cwd: '/repo',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: stdout }],
      },
      toolUseResult: { stdout, stderr: '', interrupted: false, ...extra },
    });

  test("a test runner's summary is kept as a run with no command; other output is not", () => {
    const s = session('claude-code');
    parseClaudeLines(
      [
        result('t1', 'bun test v1.3\n\n 230 pass\n 0 fail\n 812 expect() calls\n'),
        result('t2', 'On branch main\nnothing to commit'),
      ].join('\n'),
      s,
    );
    const cmds = s.records.filter((r) => r.kind === 'command');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ cmd: ORPHAN_COMMAND, orphan: true, cwd: '/repo' });
  });
});

describe('result lines belong to the check that printed them', () => {
  const counts = '12 pass\n0 fail\nRan 12 tests across 2 files.';

  test('a runner binary run by an arbitrary path is named by the runner', () => {
    expect(checkForm('/tmp/tools/proj-bun test a.ts')).toBe('bun test a.ts');
    expect(checkForm('/opt/x/node --test')).toBe('node --test');
    expect(kindOf('env PATH=/x:$PATH /tmp/tools/proj-bun test a.ts')).toBe('test');
    // A script by its path is still the script.
    expect(checkForm('./tests/run.sh')).toBe('./tests/run.sh');
    expect(checkForm('/a/b/bunny test')).toBe('/a/b/bunny test');
  });

  test("a typecheck after a test in one command never gets the test's counts", () => {
    const runs = commandRuns(
      'env PATH=/x:$PATH /tmp/tools/proj-bun test a.ts && ./node_modules/.bin/tsc -p .',
      false,
      counts,
    );
    expect(runs.map((r) => [r.kind, r.summary])).toEqual([
      ['test', ['12 pass', '0 fail']],
      ['typecheck', ['exit 0']],
    ]);
  });

  test("an unrecognized program's lines are not another check's", () => {
    const [tsc] = commandRuns('/w/unknown-runner spec && tsc -p .', false, counts);
    expect(tsc).toMatchObject({ kind: 'typecheck', summary: ['exit 0'] });
    // Even alone, a typecheck, lint or build keeps no test counts.
    expect(commandRun('tsc -p .', false, counts)?.summary).toEqual(['exit 0']);
    expect(commandRun('bun run build', false, `${counts}\n2 warnings`)?.summary).toEqual([
      '2 warnings',
    ]);
    // A test piped to `tail` keeps its own lines, failures included.
    expect(
      commandRun('go test ./... | tail -5', false, '--- FAIL: TestX\nFAIL'),
    ).toMatchObject({ outcome: 'failed', basis: 'output' });
  });
});

describe('a refused shell call is not a run', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const use = (n: number, id: string, command: string) =>
    line({
      type: 'assistant',
      timestamp: T(n),
      cwd: '/repo',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }],
      },
    });
  const result = (n: number, id: string, text: string, isError: boolean) =>
    line({
      type: 'user',
      timestamp: T(n),
      cwd: '/repo',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: id, content: text, is_error: isError },
        ],
      },
      toolUseResult: isError
        ? `Error: ${text}`
        : { stdout: text, stderr: '', interrupted: false },
    });

  test('only calls that ran, failing ones included, are commands', () => {
    const s = session('claude-code');
    parseClaudeLines(
      [
        use(1, 'a', 'shellcheck a.sh'),
        result(2, 'a', 'A hook refused this command. Refusing to run it.', true),
        use(3, 'b', 'shellcheck b.sh'),
        result(4, 'b', "The user doesn't want to proceed with this tool use.", true),
        use(5, 'c', 'shellcheck c.sh'),
        result(6, 'c', 'Exit code 1\nIn c.sh line 2: SC2086', true),
        use(7, 'd', 'shellcheck d.sh'),
        result(8, 'd', '', false),
      ].join('\n'),
      s,
    );
    const cmds = s.records.filter((r) => r.kind === 'command');
    expect(cmds.map((r) => (r as { cmd: string }).cmd)).toEqual([
      'shellcheck c.sh',
      'shellcheck d.sh',
    ]);
  });
});

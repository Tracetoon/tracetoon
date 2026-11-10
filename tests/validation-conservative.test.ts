import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commandRuns, statusMask } from '../src/digest/build.ts';
import { logRunStatable, validationSection } from '../src/graph/briefRender.ts';
import { earlierFailure, selectValidationRuns } from '../src/graph/runHistory.ts';
import { git } from '../src/util/exec.ts';
import { ClaudeLog, makeRepo, tempDir } from './helpers.ts';

const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
const PROGRAM = process.env.TRACETOON_TEST_BINARY
  ? [process.env.TRACETOON_TEST_BINARY]
  : [process.execPath, CLI];
setDefaultTimeout(60_000);

describe('what hides a run, and whether it is alone', () => {
  test('a pipe or `;` after a check hides its status; `&&` does not', () => {
    expect(statusMask('bun test 2>&1 | tail -5', 'bun test 2>&1')).toBe('pipe');
    expect(statusMask('bun test; echo done', 'bun test')).toBe('sequence');
    expect(statusMask('bun test && tsc', 'bun test')).toBeUndefined();
    expect(statusMask('bun test', 'bun test')).toBeUndefined();
  });

  test('a check is sole only when no other program shares its command', () => {
    expect(commandRuns('cd sub && bun test', false, '3 pass\n0 fail')[0]?.sole).toBe(
      true,
    );
    expect(commandRuns('bun test && tsc -p .', false, '3 pass')[0]?.sole).toBeUndefined();
    expect(commandRuns('bun test | tail -3', false, '3 pass')[0]).toMatchObject({
      masked: 'pipe',
    });
  });
});

describe('session-log runs the Validation section may state', () => {
  const row = (id: string, t: number, extra: Record<string, unknown>) => ({
    id,
    t: `2026-01-01T00:00:0${t}Z`,
    kind: 'test',
    cmd: 'bun test',
    revision: 'no later edits seen',
    later: [],
    ...extra,
  });

  test('a run the digest found uncheckable, or one with only an exit status, is not chosen', () => {
    const runs = [
      row('R1', 1, { outcome: 'passed', summary: ['3 pass', '0 fail'], statable: false }),
      row('R2', 2, {
        kind: 'lint',
        cmd: 'shellcheck a.sh',
        outcome: 'passed',
        summary: ['exit 0'],
      }),
    ];
    expect(selectValidationRuns(runs).map((r) => r.id)).toEqual([]);
    expect(
      logRunStatable({
        outcome: 'passed',
        result: 'exit 0, no output',
        cmd: 'shellcheck a.sh',
      }),
    ).toBe(false);
    expect(
      logRunStatable({
        outcome: 'passed',
        result: '3 pass',
        cmd: 'bun test',
        statable: false,
      }),
    ).toBe(false);
  });

  test('an earlier failure known only from an exit status gets no clause', () => {
    const pass = row('R2', 2, {
      outcome: 'passed',
      summary: ['3 pass'],
      basis: 'exit status',
    });
    const byStatus = row('R1', 1, {
      outcome: 'failed',
      summary: [],
      basis: 'exit status',
    });
    expect(earlierFailure([byStatus, pass], pass)).toBeUndefined();
    const byOutput = row('R1', 1, {
      outcome: 'failed',
      summary: ['1 fail'],
      basis: 'output',
    });
    expect(earlierFailure([byOutput, pass], pass)?.id).toBe('R1');
  });
});

describe('the brief, end to end', () => {
  const GREET =
    'export function greet(name: string): string {\n  return `Hi ${name}`;\n}\n';

  function brief(steps: (log: ClaudeLog, root: string) => void) {
    const claudeHome = tempDir('tracetoon-claude-');
    const scratch = tempDir('tracetoon-env-');
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: tempDir('tracetoon-codex-'),
      ANTIGRAVITY_HOME: tempDir('tracetoon-gemini-'),
      GEMINI_HOME: tempDir('tracetoon-gemini-'),
      TRACETOON_CONFIG: join(scratch, 'config.json'),
    };
    const cli = (cwd: string, ...args: string[]) => {
      const r = spawnSync(PROGRAM[0]!, [...PROGRAM.slice(1), ...args], {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
      });
      return JSON.parse(r.stdout);
    };
    const repo = makeRepo();
    const log = new ClaudeLog(repo.root)
      .prompt('Add a greet helper')
      .write(join(repo.root, 'src/greet.ts'), GREET);
    steps(log, repo.root);
    log.save(claudeHome, 'conservative');
    mkdirSync(join(repo.root, 'src'), { recursive: true });
    writeFileSync(join(repo.root, 'src/greet.ts'), GREET);
    git(repo.root, ['add', '.']);
    git(repo.root, ['commit', '-q', '-m', 'feat: greet']);
    const run = cli(repo.root, '--json', 'digest', '--offline').run as string;
    const sections = cli(repo.root, '--json', 'query', 'brief', '--run', run).sections;
    const rows = (title: string) =>
      (sections.find((s: any) => s.title === title)?.rows ?? []) as Record<string, any>[];
    return {
      validation: validationSection({ unchecked: [], sections })
        .split('\n')
        .filter((l) => l.startsWith('- ')),
      limits: rows('limits').map((l) => String(l.limit)),
    };
  }

  test('piped, chained and exit-0-only runs stay out; a piped status is said as such', () => {
    const { validation, limits } = brief((log) =>
      log
        .bash('bun test 2>&1 | tail -5', '3 pass\n0 fail')
        .bash('shellcheck a.sh', '')
        .bash('bun test && bun x tsc --noEmit', '3 pass\n0 fail')
        .bash('bun run typecheck 2>&1 | tail -3', '$ tsc --noEmit'),
    );
    expect(validation).toEqual([
      '- Tracetoon found no test, typecheck or lint result it could read in the session logs.',
    ]);
    expect(limits.some((l) => l.includes('its exit status was hidden by a pipe'))).toBe(
      true,
    );
    expect(
      limits.some((l) => /has no result|no result for it was captured/.test(l)),
    ).toBe(false);
  });

  test("a run alone with its own result lines is shown; an exit-status failure isn't recalled", () => {
    const { validation, limits } = brief((log) =>
      log
        .bash('bun test', '', true)
        .bash('bun test tests/a.test.ts 2>&1 | tail -3', '')
        .bash('bun test', '4 pass\n0 fail'),
    );
    expect(validation[0]).toBe(
      '- `bun test`: passed (4 pass, 0 fail) in the session logs.',
    );
    expect(validation.join('\n')).not.toContain('An earlier run');
    // The later pass covers the piped run with no result.
    expect(limits.some((l) => l.includes('tests/a.test.ts'))).toBe(false);
    // And covers the file: no "recognized no passing" point beside it.
    expect(limits.some((l) => l.includes('recognized no passing'))).toBe(false);
  });
});

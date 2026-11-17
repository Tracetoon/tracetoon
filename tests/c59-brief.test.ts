import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandRuns,
  commitsBefore,
  everyStepMustPass,
  keptRemote,
  scriptOutcome,
} from '../src/digest/build.ts';
import { fakePhrases, LOCAL_SERVER } from '../src/graph/build.ts';
import { environmentRows, sameWord } from '../src/graph/briefExtras.ts';
import { shownCommand, validationSection } from '../src/graph/briefRender.ts';
import { pinnedRunFailure } from '../src/graph/toolchain.ts';
import { workflowsRunning } from '../src/graph/workflowJobs.ts';
import { waitingForOtherCheck } from '../src/commands/workflow.ts';
import { DRAFTING_RULES, graphNext } from '../src/commands/digest.ts';
import {
  CHECK_TIMEOUT_MS,
  checkTimeoutMs,
  compactCheckText,
  repoRelative,
  timedOutText,
  type CheckReceipt,
} from '../src/workflow/checks.ts';
import { readFileSync } from 'node:fs';

const host = { platform: 'linux', arch: 'x64' };

describe('a script run whose verdict is PASS', () => {
  test('a PASS verdict line passes despite a skipped part (0/2 smokes)', () => {
    expect(
      scriptOutcome(undefined, 'PASS book walk: 163/163 steps, 0/2 graphical smokes.')
        .outcome,
    ).toBe('passed');
    expect(
      scriptOutcome(undefined, 'FAIL book walk: 151/163 steps, 0/2 graphical smokes.')
        .outcome,
    ).toBe('failed');
  });

  test('a clean exit of an && chain is a clean exit of its script', () => {
    expect(
      everyStepMustPass('bun test a.ts && bun scripts/build.ts && bun scripts/walk.ts'),
    ).toBe(true);
    expect(everyStepMustPass("docker run img -c 'bun scripts/walk.ts; echo x'")).toBe(
      true,
    );
    expect(everyStepMustPass('bun scripts/walk.ts; echo done')).toBe(false);
    expect(everyStepMustPass('bun scripts/walk.ts || true')).toBe(false);
    expect(everyStepMustPass('bun scripts/walk.ts | tail -3')).toBe(false);
    expect(everyStepMustPass('bun scripts/walk.ts 2>&1')).toBe(true);
    const runs = commandRuns(
      'bun test test/a.test.ts && bun scripts/walk.ts --skip-smoke',
      false,
      '(pass) a\n 3 pass\n 0 fail\nPASS walk: 163/163 steps, 0/2 smokes.',
      (p) => p === 'scripts/walk.ts',
    );
    const walk = runs.find((r) => r.cmd.includes('walk.ts'))!;
    expect(walk.outcome).toBe('passed');
    expect(walk.basis).toBe('exit status');
  });
});

describe('check timeouts', () => {
  test('default limit is 15 minutes', () => {
    const was = process.env.TRACETOON_CHECK_TIMEOUT_MIN;
    delete process.env.TRACETOON_CHECK_TIMEOUT_MIN;
    expect(CHECK_TIMEOUT_MS).toBe(15 * 60_000);
    expect(checkTimeoutMs()).toBe(15 * 60_000);
    if (was !== undefined) process.env.TRACETOON_CHECK_TIMEOUT_MIN = was;
  });

  test('a timed-out check reads "timed out (incomplete), N s", never failed, no retry advice', () => {
    const r: CheckReceipt = {
      v: 1,
      name: 'test',
      command: ['bun', 'test'],
      cwd: '',
      kind: 'test',
      fingerprint: 'x',
      environment: 'y',
      outcome: 'failed',
      exitCode: null,
      summary: ['3 pass'],
      startedAt: '2026-01-01T00:00:00Z',
      durationMs: 830_400,
      timedOut: true,
    };
    const text = compactCheckText(r);
    expect(text).toStartWith('test: timed out (incomplete), 830 s');
    expect(text).not.toMatch(/failed|3 pass/);
    expect(text).toContain("don't rerun it");
    expect(timedOutText(1500)).toBe('timed out (incomplete), 2 s');
  });

  test('Validation shows a timed-out receipt as incomplete', () => {
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
              outcome: 'timed out (incomplete)',
              result: 'timed out (incomplete), 830 s',
              when: 'fresh',
              cmd: 'bun test',
            },
          ],
        },
      ],
    } as any);
    expect(section).toContain('- `bun test`: timed out (incomplete), 830 s;');
    expect(section).not.toMatch(/failed/);
  });

  test('a second check waits in the foreground while another holds the lock', async () => {
    let n = 0;
    const out = await waitingForOtherCheck(
      async () => {
        if (n++ < 2) throw new Error('Validation is already running for this Tracetoon.');
        return 'done';
      },
      60_000,
      1,
    );
    expect(out).toBe('done');
    expect(n).toBe(3);
    await expect(
      waitingForOtherCheck(
        async () => {
          throw new Error('other');
        },
        60_000,
        1,
      ),
    ).rejects.toThrow('other');
  });
});

describe('environment-only failures', () => {
  test('a pinned toolchain other than this one, with a version complaint, is not a code failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c59-pin-'));
    try {
      writeFileSync(join(dir, '.bun-version'), '1.2.0\n');
      const running = (t: string) => (t === 'bun' ? '1.3.14' : undefined);
      expect(
        pinnedRunFailure(
          dir,
          ['bun', 'test'],
          'error: this project requires bun 1.2.0',
          running,
        ),
      ).toBe('as pinned here (bun 1.3.14 vs pinned 1.2.0)');
      // A plain test failure says nothing about versions: the code's failure.
      expect(
        pinnedRunFailure(dir, ['bun', 'test'], '(fail) adds\n 1 fail', running),
      ).toBeUndefined();
      // Another program's check: the bun pin doesn't apply.
      expect(
        pinnedRunFailure(dir, ['cargo', 'test'], 'requires bun 1.2.0', running),
      ).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Validation says "could not run as pinned here" with no counts', () => {
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
              result: 'could not run here: as pinned here (bun 1.3.14 vs pinned 1.2.0)',
              when: 'fresh',
              cmd: 'bun test',
            },
          ],
        },
      ],
    } as any);
    expect(section).toContain(
      '- `bun test`: could not run as pinned here (bun 1.3.14 vs pinned 1.2.0); it got no pass/fail result on the code.',
    );
  });
});

describe('repository-relative commands', () => {
  test('no <repo> placeholder in a shown command', () => {
    expect(repoRelative(['env', 'X=<repo>/dist/a.mjs', 'bun', 'test', '<repo>'])).toEqual(
      ['env', 'X=dist/a.mjs', 'bun', 'test', '.'],
    );
    expect(shownCommand('bun <repo>/scripts/a.ts --root <repo>')).toBe(
      'bun scripts/a.ts --root .',
    );
  });
});

describe('limits: false absences', () => {
  const roles = new Map([
    ['src/update/apply.ts', 'behavior'],
    ['tests/update.test.ts', 'tests'],
    ['scripts/build-win.ps1', 'behavior'],
  ]);
  const testHunk = (extra: Record<string, unknown>) => ({
    change: 'CH2',
    file: 'tests/update.test.ts',
    code: ['+ function fakeRelease(tag: string) {'],
    conds: [],
    ...extra,
  });
  const srcHunk = {
    change: 'CH1',
    file: 'src/update/apply.ts',
    code: ['+ const res = await fetch(url);'],
    conds: [],
    symbols: ['applyRelease'],
  };
  const fakeRow = (hs: any[], live?: any) =>
    environmentRows(hs, roles, host, undefined, false, [], new Map(), live)
      .map((r) => String(r.limit))
      .find((l) => /changed tests/.test(l));

  test('the fakes row names the specific fake', () => {
    const row = fakeRow([srcHunk, testHunk({ fakes: ['fake release feed'] })]);
    expect(row).toContain('use a fake release feed (`fakeRelease`)');
    expect(row).toContain('not the real release feed');
  });

  test('a fake server the tests start locally is a real path: no row', () => {
    expect(
      fakeRow([srcHunk, testHunk({ fakes: ['fake release server'], localServer: true })]),
    ).toBeUndefined();
  });

  test('a recorded live run of the faked code drops the row', () => {
    const hs = [
      { ...srcHunk, file: 'src/release.ts', symbols: ['release'] },
      {
        change: 'CH3',
        file: 'src/commands/update.ts',
        code: ['+ await release(x);'],
        conds: [],
        scope: 'updateCmd',
        touched: ['updateCmd'],
      },
      testHunk({}),
    ];
    roles.set('src/release.ts', 'behavior');
    roles.set('src/commands/update.ts', 'behavior');
    const live = {
      invocations: [{ cmd: 'tracetoon update --check', out: [] }],
      hunks: hs,
    };
    expect(fakeRow(hs)).toBeDefined();
    expect(fakeRow(hs, live)).toBeUndefined();
  });

  test('a changed script a CI workflow runs is dropped when that CI ran', () => {
    const hs = [
      {
        change: 'CH1',
        file: 'scripts/build-win.ps1',
        code: ['+ Write-Host x'],
        conds: [],
      },
    ];
    const callers = new Map([['scripts/build-win.ps1', ['ci.yml']]]);
    const scriptRow = (ciSeen: boolean, ci: any[], c = callers) =>
      environmentRows(
        hs,
        roles,
        host,
        ['bun test'],
        ciSeen,
        ci,
        new Map(),
        undefined,
        c,
      ).some((r) => /changed script/.test(String(r.limit)));
    expect(scriptRow(false, [])).toBe(true);
    expect(scriptRow(true, [])).toBe(false);
    expect(scriptRow(false, [{ os: [], workflows: ['ci.yml'], t: 't' }])).toBe(false);
    expect(scriptRow(true, [], new Map())).toBe(true);
  });

  test('workflowsRunning finds a run step, not a paths filter', () => {
    const wf = (text: string) => [{ file: '.github/workflows/ci.yml', text }];
    expect(
      workflowsRunning(
        'scripts/build-win.ps1',
        wf('    steps:\n      - run: ./scripts/build-win.ps1 -Release\n'),
      ),
    ).toEqual(['ci.yml']);
    expect(
      workflowsRunning(
        'scripts/build-win.ps1',
        wf('      - run: pwsh .\\scripts\\build-win.ps1\n'),
      ),
    ).toEqual(['ci.yml']);
    expect(
      workflowsRunning(
        'scripts/build-win.ps1',
        wf('on:\n  push:\n    paths:\n      - scripts/build-win.ps1\njobs: {}\n'),
      ),
    ).toEqual([]);
    expect(
      workflowsRunning('scripts/build.ps1', wf('      - run: ./scripts/prebuild.ps1\n')),
    ).toEqual([]);
  });

  test('fake phrases come from strings and comments, local servers from code', () => {
    expect(
      fakePhrases("describe('update against a fake release server', () => {"),
    ).toEqual(['fake release server']);
    expect(fakePhrases('const fakeRelease = 1;')).toEqual([]);
    expect(LOCAL_SERVER.test('server = Bun.serve({ port: 0, fetch })')).toBe(true);
    expect(LOCAL_SERVER.test('url = `http://127.0.0.1:${port}`')).toBe(true);
    expect(LOCAL_SERVER.test('await fetch(remoteUrl)')).toBe(false);
  });

  test('command words match their forms', () => {
    expect(sameWord('compare', 'comparison')).toBe(true);
    expect(sameWord('upload', 'uploader')).toBe(true);
    expect(sameWord('score', 'scope')).toBe(false);
    expect(sameWord('test', 'tests')).toBe(false);
  });

  test('`git commit …; git push` on one line is one action', () => {
    expect(
      commitsBefore('git add a && git commit -m "x" && git push origin main', 'git push'),
    ).toBe(true);
    expect(commitsBefore('git commit -m x; git push', 'git push')).toBe(true);
    expect(commitsBefore('git push origin main', 'git push')).toBe(false);
    expect(commitsBefore('git push && git commit -m x', 'git push')).toBe(false);
  });

  test('a long CI watch loop never crowds out a later push', () => {
    const remote = [
      ...Array.from({ length: 25 }, (_, i) => ({ kind: 'ci', i })),
      { kind: 'publish', i: 99 },
    ];
    const kept = keptRemote(remote);
    expect(kept.length).toBe(20);
    expect(kept.at(-1)).toEqual({ kind: 'publish', i: 99 });
  });
});

describe('drafting guidance', () => {
  const skill = readFileSync(
    join(import.meta.dir, '../plugin/skills/tracetoon/SKILL.md'),
    'utf8',
  );
  const drafting = readFileSync(
    join(import.meta.dir, '../plugin/skills/tracetoon/references/drafting.md'),
    'utf8',
  );
  test('checks run in the foreground and the turn ends only after publishing', () => {
    expect(skill).toContain('`timeout: 600000`');
    expect(skill).toMatch(/never end your turn while one\s+runs/);
    expect(skill).toMatch(/Render, review and publish before ending the turn/);
    const next = graphNext('R1');
    expect(next).toContain('FOREGROUND');
    expect(next).toContain('timed out (incomplete)');
    expect(next).toContain('render, review and publish before ending the turn');
    expect(next).not.toContain('10 min');
  });
  test('session-history caveats, environment-only failures and economy', () => {
    // Session history, push/CI and tag status are written under Validation by render.
    expect(drafting).toMatch(
      /`render` writes every open `limits` row under the\s+Validation section/,
    );
    expect(drafting).toContain('could not run as pinned here');
    expect(drafting).toMatch(/lockfiles, rebuilt bundles/);
    expect(DRAFTING_RULES).toMatch(
      /Render writes every open `limits` row under the Validation section/,
    );
    expect(drafting).not.toMatch(/logs Tracetoon read|Tracetoon kept/);
  });
});

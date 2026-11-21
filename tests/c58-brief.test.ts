import { describe, expect, test } from 'bun:test';
import { ciTargetOf, finishedRunnerOs, runIdsIn } from '../src/digest/build.ts';
import { unansweredDecision } from '../src/graph/build.ts';
import { environmentRows } from '../src/graph/briefExtras.ts';
import { ghTargetsRepo, repoNames } from '../src/util/shell.ts';

describe('decisions without an answer', () => {
  test('a question with no recorded answer is no decision', () => {
    const d = (answers: (string | undefined)[]) =>
      ({
        id: 'D1',
        text: 'q',
        questions: answers.map((answer, i) => ({ question: `Q${i}?`, answer })),
      }) as any;
    expect(unansweredDecision(d([undefined]))).toBe(true);
    expect(unansweredDecision(d([undefined, undefined]))).toBe(true);
    expect(unansweredDecision(d(['   ']))).toBe(true);
    expect(unansweredDecision(d([undefined, 'Yes']))).toBe(false);
    // A decision with no questions (a plain choice) is kept.
    expect(unansweredDecision({ id: 'D2', text: 'chose x' } as any)).toBe(false);
  });
});

describe('CI runs of a named workflow', () => {
  test('a workflow file and run ids are read from CI commands and their output', () => {
    expect(ciTargetOf('gh workflow run release.yml --repo o/app --ref fix/x')).toEqual({
      workflow: 'release.yml',
    });
    expect(ciTargetOf('gh run list --repo o/app --workflow ci.yml --limit 1')).toEqual({
      workflow: 'ci.yml',
    });
    expect(ciTargetOf('gh run watch 33433279489 --repo o/app --exit-status')).toEqual({
      run: '33433279489',
    });
    expect(ciTargetOf('gh pr checks 11')).toEqual({});
    expect(
      runIdsIn(
        '[{"databaseId":33433279489,"url":"https://github.com/o/app/actions/runs/33433279489"}]',
      ),
    ).toEqual(['33433279489']);
  });

  test('a gh command naming this repository with --repo counts from another folder', () => {
    const names = repoNames(undefined, ['/home/u/src/app']);
    expect(ghTargetsRepo('gh run watch 1 --repo owner/app --exit-status', names)).toBe(
      true,
    );
    expect(ghTargetsRepo('gh pr checks 3 -R owner/app-content --watch', names)).toBe(
      false,
    );
    expect(
      ghTargetsRepo('git push && gh workflow run release.yml --repo owner/app', names),
    ).toBe(true);
    expect(ghTargetsRepo('gh repo clone owner/app', names)).toBe(false);
  });

  test('finished jobs count as runs on their platform, pending ones do not', () => {
    expect(
      finishedRunnerOs(
        'X build (windows-latest) failed\n* check (macos-latest) pending\n✓ build (ubuntu-latest) in 2m',
      ),
    ).toEqual(['Linux', 'Windows']);
  });

  const hunks = [
    {
      change: 'CH1',
      file: 'scripts/build.ts',
      code: ["+ if (process.platform === 'win32') args.push('--windows-icon');"],
      conds: [],
    },
    {
      change: 'CH2',
      file: '.github/workflows/release.yml',
      code: ['+     runs-on: windows-latest'],
      conds: [],
    },
  ];
  const roles = new Map([
    ['scripts/build.ts', 'behavior'],
    ['.github/workflows/release.yml', 'behavior'],
  ]);
  const host = { platform: 'linux', arch: 'x64' };
  const edits = new Map([
    ['scripts/build.ts', '2026-01-01T00:00:05Z'],
    ['.github/workflows/release.yml', '2026-01-01T00:00:06Z'],
  ]);
  const rows = (ci: any[]) =>
    environmentRows(hunks, roles, host, ['bun test'], false, ci, edits).map((r) =>
      String(r.limit),
    );

  test('a run of the workflow before the last edit is said as such, never "none shows"', () => {
    const before = rows([
      { os: [], workflows: ['release.yml'], t: '2026-01-01T00:00:01Z' },
    ]);
    const win = before.filter((l) => /Windows-specific/.test(l));
    expect(win.length).toBe(2);
    for (const l of win) {
      expect(l).toContain('a Windows CI run (release.yml) came before the last edit of');
      expect(l).toContain('none after');
      expect(l).not.toContain('none shows');
    }
    expect(
      before.some((l) =>
        l.startsWith(
          'a CI run of .github/workflows/release.yml came before its last edit',
        ),
      ),
    ).toBe(true);
    expect(before.some((l) => /no run of (it|them) is in the logs/.test(l))).toBe(false);
  });

  test('a passing run of the workflow after the last edit is a run on its platform', () => {
    const after = rows([
      { os: [], workflows: ['release.yml'], t: '2026-01-01T00:00:09Z' },
    ]);
    expect(after.some((l) => /Windows-specific/.test(l))).toBe(false);
    expect(after.some((l) => /release\.yml/.test(l))).toBe(false);
    const failed = rows([
      { os: [], workflows: ['release.yml'], t: '2026-01-01T00:00:09Z', failed: true },
    ]);
    expect(
      failed.some((l) =>
        /the Windows CI run \(release\.yml\) after the last edit of .* failed/.test(l),
      ),
    ).toBe(true);
  });

  test('with no CI run the old wording stays', () => {
    const none = rows([]);
    expect(none.some((l) => /so none shows the Windows path running/.test(l))).toBe(true);
    expect(none.some((l) => /no run of it is in the session logs/.test(l))).toBe(true);
  });
});

describe('workflow jobs', () => {
  const base = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: bun run build
      - name: Upload binaries
        uses: actions/upload-artifact@v4
  publish:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Publish release
        run: gh release create
`;
  const head = `name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@0123456789abcdef
      - name: Build
        run: bun run build
      - name: Upload binaries
        uses: actions/upload-artifact@v4
  sign-windows:
    runs-on: windows-latest
    needs: [build]
    if: vars.SIGNING_ENABLED == 'true'
    steps:
      - name: Submit signing request
        uses: signpath/github-action-submit-signing-request@v1
  publish:
    runs-on: ubuntu-latest
    needs: [build, sign-windows]
    if: github.event_name == 'push'
    steps:
      - name: Publish release
        run: gh release create
`;
  test('jobs added, changed and triggers are summarized with runs-on, needs, if and shipping steps', async () => {
    const { workflowChanges } = await import('../src/graph/workflowJobs.ts');
    const lines = workflowChanges(base, head);
    expect(lines).toContain('triggers: push → push, workflow_dispatch');
    expect(lines).toContain(
      "job sign-windows added: runs-on windows-latest; needs build; if vars.SIGNING_ENABLED == 'true'; steps: Submit signing request (signpath/github-action-submit-signing-request)",
    );
    expect(lines).toContain(
      "job publish changed: needs build → build, sign-windows; if none → github.event_name == 'push'",
    );
    expect(lines).toContain('job build changed: 1 action version changed');
    expect(workflowChanges(head, base)).toContain(
      'job sign-windows removed (it ran: Submit signing request (signpath/github-action-submit-signing-request))',
    );
  });
});

describe('change units', () => {
  const h = (id: string, file: string, added: number, removed: number) =>
    ({
      id,
      file,
      added,
      removed,
      touched: [],
      fresh: [],
      symbols: [],
      words: [],
      tests: [],
    }) as any;
  test('a substantially changed workflow becomes its own unit', async () => {
    const { splitWorkflowUnits } = await import('../src/graph/build.ts');
    const groups = new Map([
      [
        'commit:a',
        [
          h('H1', 'src/a.ts', 10, 2),
          h('H2', '.github/workflows/release.yml', 30, 5),
          h('H3', '.github/workflows/ci.yml', 1, 1),
        ],
      ],
    ]);
    splitWorkflowUnits(groups);
    expect([...groups.keys()].sort()).toEqual([
      'commit:a',
      'commit:a|workflow:.github/workflows/release.yml',
    ]);
    expect(groups.get('commit:a')!.map((x) => x.id)).toEqual(['H1', 'H3']);
  });
  test('a one-line unit joins the unit holding most of its file', async () => {
    const { foldStrayLines } = await import('../src/graph/build.ts');
    const groups = new Map([
      ['commit:a', [h('H1', 'src/a.ts', 40, 2)]],
      ['commit:b', [h('H2', 'src/a.ts', 1, 1)]],
      ['commit:c', [h('H3', 'src/b.ts', 1, 0)]],
    ]);
    foldStrayLines(groups);
    expect([...groups.keys()].sort()).toEqual(['commit:a', 'commit:c']);
    expect(groups.get('commit:a')!.map((x) => x.id)).toEqual(['H1', 'H2']);
  });
});

describe('extraction', () => {
  test('a body moved into a new helper is said as an extraction', async () => {
    const { extractionOf } = await import('../src/graph/queries.ts');
    const hs = [
      {
        file: 'src/run.ts',
        moved: 12,
        scope: 'runAll',
        touched: ['runAll'],
        fresh: ['runOne'],
        code: [
          '+ function runOne(job: Job) {',
          '- for (const j of jobs) { … } ⇒ + for (const j of jobs) await runOne(j);',
        ],
      },
    ];
    expect(extractionOf(hs, 'src/run.ts')).toBe(
      'extracted into `runOne`; `runAll` now calls it',
    );
    expect(extractionOf([{ ...hs[0], fresh: [] }], 'src/run.ts')).toBeUndefined();
  });
});

describe('reusable workflow jobs', () => {
  test('a job calling another workflow says which', async () => {
    const { workflowChanges } = await import('../src/graph/workflowJobs.ts');
    const head =
      'on: [push]\njobs:\n  walk:\n    uses: ./.github/workflows/walk.yml\n    secrets: inherit\n';
    expect(workflowChanges('on: [push]\njobs: {}\n', head)).toContain(
      'job walk added: calls ./.github/workflows/walk.yml',
    );
  });
});

describe('extraction stays in its file', () => {
  test('lines moved in a docs file are not an extraction into code elsewhere', async () => {
    const { extractionOf } = await import('../src/graph/queries.ts');
    const hs = [
      { file: 'docs/guide.md', moved: 1, code: [] },
      {
        file: 'src/deps.ts',
        scope: 'install',
        fresh: ['isImmutable'],
        code: ['+ function isImmutable() {', '+ if (isImmutable()) return plan;'],
      },
    ];
    expect(extractionOf(hs, 'docs/guide.md')).toBeUndefined();
  });
});

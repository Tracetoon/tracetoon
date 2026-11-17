import { describe, expect, test } from 'bun:test';
import {
  applyBrief,
  bodyFlags,
  limitSentence,
  missedBehaviors,
  redactLocalPaths,
  tidyProse,
  titleFlags,
  validationSection,
  VALIDATION_MARKER,
  type BriefParts,
} from '../src/graph/briefRender.ts';
import { entryRow, sessionEndRows, untestedRows } from '../src/graph/briefExtras.ts';
import { patchHunks } from '../src/graph/build.ts';
import { testScanNode } from '../src/graph/headScan.ts';
import { withGraph } from '../src/graph/engine.ts';
import { GRAPH_SCHEMA, type EvidenceGraph } from '../src/graph/model.ts';
import { behaviorRows, markGoal } from '../src/graph/queries.ts';

const N = (label: any, id: string, props: Record<string, any>) => ({ label, id, props });
const R = (type: any, from: [any, string], to: [any, string], props?: any) => ({
  type,
  from: { label: from[0], id: from[1] },
  to: { label: to[0], id: to[1] },
  ...(props ? { props } : {}),
});
const t = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
const graphOf = (nodes: any[], rels: any[] = []): EvidenceGraph => ({
  schema: GRAPH_SCHEMA,
  nodes,
  rels,
  stats: { nodes: 0, rels: 0, hunks: 0, linkedHunks: 0, edits: 0, deadEndEdits: 0 },
});
const sec = (title: string, rows: Record<string, unknown>[]) => ({
  title,
  columns: Object.keys(rows[0] ?? {}),
  rows,
});
const parts = (sections: ReturnType<typeof sec>[], extra: Partial<BriefParts> = {}) =>
  ({ sections, unchecked: [], ...extra }) as BriefParts;

describe('the Validation section carries the checks, the open points and history', () => {
  const receipts = [
    {
      check: 'V1',
      kind: 'test',
      outcome: 'passed',
      result: '12 pass; 0 fail',
      cmd: 'bun test',
    },
    {
      check: 'V2',
      kind: 'typecheck',
      outcome: 'passed',
      result: '',
      cmd: 'bun run typecheck',
    },
    { check: 'V3', kind: 'lint', outcome: 'passed', result: '', cmd: 'bun run lint' },
  ];
  test('passes collapse to one line; every open limit follows as a plain sentence', () => {
    const b = parts([
      sec('limits', [
        {
          ref: 'L1',
          change: null,
          kind: 'open',
          limit:
            "The session's last test run (R4) came before the final edits to src/a.ts; the fresh check on the submitted content came after it.",
        },
        {
          ref: 'L2',
          change: null,
          kind: 'open',
          limit:
            'The session pushed (`git push`); CI results for the final head are not in the logs Tracetoon read.',
        },
        {
          ref: 'L3',
          change: 'CH1',
          kind: 'open',
          limit:
            'Tracetoon recognized no passing test, build, lint or typecheck run after the last captured edit of src/a.ts.',
        },
      ]),
      sec('validation', receipts),
    ]);
    const out = validationSection(b);
    expect(out).toContain(
      '- Checks passed on the submitted content: `bun test` (12 pass, 0 fail), `bun run typecheck`, `bun run lint`.',
    );
    expect(out).toContain('Open points:');
    expect(out).toContain(
      "- The session's last test run came before the final edits to src/a.ts; the fresh check on the submitted content came after it.",
    );
    expect(out).toContain(
      '- The session pushed (`git push`); CI results for the final head are not in the session logs.',
    );
    // A "no pass after the last edit" point a fresh pass answers is not repeated.
    expect(out).not.toContain('recognized no passing');
    expect(out).not.toMatch(/\bR4\b|Tracetoon/);
  });

  test('open points render even when no check result can be stated', () => {
    const b = parts([
      sec('limits', [
        {
          ref: 'L1',
          change: null,
          kind: 'open',
          limit:
            'The diff bumps the version (1.2.0 → 1.3.0), but no tag or release appears in the session logs.',
        },
      ]),
    ]);
    expect(validationSection(b)).toBe(
      '## Validation\n\nOpen points:\n\n- The diff bumps the version (1.2.0 → 1.3.0), but no tag or release appears in the session logs.',
    );
  });

  test('a failure keeps its counts but not quoted source lines or local paths', () => {
    const b = parts([
      sec('changes', [{ change: 'CH1', where: ['src/a.ts (run)'] }]),
      sec('validation', [
        {
          check: 'V1',
          kind: 'test',
          outcome: 'failed',
          result:
            '3 pass; 1 fail; 103 |       expect(a).toEqual(b); Report: /src/test-results/walk/report.json',
          cmd: 'bun test',
        },
      ]),
    ]);
    const out = validationSection(b);
    expect(out).toContain(
      '- `bun test`: failed (3 pass, 1 fail, Report: <local path>), run on the submitted content.',
    );
  });

  test('limit sentences: no refs, commit-message results attributed', () => {
    expect(
      limitSentence(
        "\"Full suite passed\" comes only from commit abc1234def56's message: attribute it to that message, and don't say what any run did or didn't show.",
      ),
    ).toBe('Only commit abc1234def56\'s message reports "Full suite passed".');
    expect(
      limitSentence(
        'The changed tests (tests/u.test.ts) replace collaborators with fakes or stubs (`fakeRelease`); CH1 is reached that way: they check the logic around those steps, not the real steps.',
      ),
    ).toBe(
      'The changed tests (tests/u.test.ts) replace collaborators with fakes or stubs (`fakeRelease`).',
    );
    expect(
      limitSentence(
        'No passing check run was recorded after the last commit (f7ec46eedb0b); the last pass (R63, test) came before it.',
      ),
    ).toBe(
      'No passing check run was recorded after the last commit (f7ec46eedb0b); the last pass (test) came before it.',
    );
  });

  test('with the marker, open limits are not left for the writer to cover', () => {
    const b = parts([
      sec('limits', [
        { ref: 'L1', change: null, kind: 'open', limit: 'No test file names src/a.ts.' },
      ]),
    ]);
    expect(applyBrief(`Adds a. [L1]\n\n${VALIDATION_MARKER}\n`, b).uncovered).toEqual([]);
    expect(applyBrief('Adds a thing here now.', b).uncovered).toEqual([
      'L1 (open point): No test file names src/a.ts.',
    ]);
  });
});

describe('local paths and sentence joins', () => {
  test('absolute paths become repo-relative or <local path>; URLs stay', () => {
    expect(
      redactLocalPaths('see /home/u/repo/src/a.ts and https://x.io/a/b', ['src/a.ts']),
    ).toBe('see src/a.ts and https://x.io/a/b');
    expect(redactLocalPaths('Report: /src/test-results/a/report.json')).toBe(
      'Report: <local path>',
    );
  });
  test('a doubled space before a lowercase sentence start is joined cleanly', () => {
    expect(tidyProse('It stops here.  the logs record CI.')).toBe(
      'It stops here. The logs record CI.',
    );
    expect(tidyProse('Keep `a  b` and\n    code  here')).toBe(
      'Keep `a  b` and\n    code  here',
    );
  });
});

describe('render-check flags', () => {
  const b = parts([
    sec('changes', [
      {
        change: 'CH1',
        where: ['src/a.ts (run)'],
        was: '',
        before: null,
        behavior: ['a.ts: + if (opts.force) return retry();'],
      },
    ]),
    sec('behaviors', [
      {
        ref: 'B1',
        change: 'CH1',
        text: 'Retries the upload when the server returns 503',
        from: 'abc1234#1',
      },
    ]),
    sec('process', [{ ref: 'PR1', kind: 'entry', fact: 'Start at `run` in src/a.ts.' }]),
  ]);
  const tail =
    '\n\nWhere to start: `run` in src/a.ts. [PR1]\n\nFeedback wanted: is one retry enough? [CH1]';
  test('universal words on conditional rows, "Previously" without old code, brief vocabulary', () => {
    const r = applyBrief(
      `The command always retries [CH1]. Previously it gave up [CH1]. The brief shows a limits row for this [CH1].${tail}`,
      b,
    );
    const problems = r.flags.map((f) => `${f.severity}: ${f.sentence}`);
    expect(problems).toContain('check: The command always retries.');
    expect(problems).toContain('check: Previously it gave up.');
    expect(problems).toContain('fix: The brief shows a limits row for this.');
  });
  test('required slots: a body without "Where to start" or "Feedback wanted" is flagged', () => {
    const flags = bodyFlags(
      'Adds a flag [CH1]. It is off by default [CH1]. It logs once [CH1]. It needs no setup [CH1].',
      b,
      new Set(['CH1']),
    );
    expect(flags.map((f) => f.sentence)).toEqual([
      '(no "Where to start" line)',
      '(no "Feedback wanted" line)',
      '(behaviors of cited changes the description never mentions)',
    ]);
    expect(
      bodyFlags(
        `Retries the upload when the server returns 503. [CH1]${tail}`,
        b,
        new Set(['CH1']),
      ),
    ).toEqual([]);
  });
  test('behaviors of cited units the body never mentions', () => {
    expect(missedBehaviors('Adds a flag.', b, new Set(['CH1']))).toEqual([
      'B1 (CH1): Retries the upload when the server returns 503',
    ]);
    // An uncited unit's behaviors are not asked for.
    expect(missedBehaviors('Adds a flag.', b, new Set(['CH2']))).toEqual([]);
  });
  test("a title that only restates the head commit's subject of several", () => {
    const subjects = [
      'feat: add a bulk migrator for old trails',
      'docs: document upgrade offer',
      'fix: keep the offer pending without a TTY',
    ];
    expect(titleFlags('Keep the offer pending without a TTY', subjects)).toHaveLength(1);
    expect(titleFlags('Migrate old trails and offer it on upgrade', subjects)).toEqual(
      [],
    );
    expect(titleFlags('Keep the offer pending without a TTY', subjects.slice(2))).toEqual(
      [],
    );
  });
});

describe('requests: one goal, bare prompts resolved', () => {
  test('"Implement the plan." shows the plan it continues', () => {
    const requests: Record<string, unknown>[] = [
      { ref: 'S3', kind: 'user request', text: 'Implement the plan.' },
      { ref: 'S4', kind: 'user request', text: 'create a PR for this work' },
    ];
    const background: Record<string, unknown>[] = [
      {
        ref: 'S1',
        kind: 'why this work started',
        text: 'Put a plan together for signing.',
      },
      {
        ref: 'P1',
        kind: "plan that this PR's request to carry out the plan refers to",
        text: '# Signing plan …',
      },
    ];
    markGoal(requests, background, [{ change: 'CH1', requests: ['S3'] }]);
    expect(requests[0]!.kind).toMatch(
      /^goal \(the user's "Implement the plan\." continues P1/,
    );
    expect(requests[0]!.text).toBe('# Signing plan …');
    expect(requests[1]!.kind).toBe('user request');
    expect(background[1]!.text).toBe('(shown under requests as the goal, S3)');
  });
  test('the request linked to most change units is the goal', () => {
    const requests: Record<string, unknown>[] = [
      { ref: 'S1', kind: 'goal', text: 'Set up the repo' },
      { ref: 'S2', kind: 'user request', text: 'Add retries to uploads' },
    ];
    markGoal(
      requests,
      [],
      [
        { change: 'CH1', requests: ['S2'] },
        { change: 'CH2', requests: ['S2 (asked before the commit)'] },
        { change: 'CH3', requests: ['S1'] },
      ],
    );
    expect(requests.map((r) => r.kind)).toEqual(['user request', 'goal; user request']);
  });
});

describe('behavior rows', () => {
  test('one row per commit sentence of a unit, round-robin, capped', () => {
    const rows = behaviorRows(
      [
        { change: 'CH1', behavior: ['a.ts: + x'] },
        { change: 'CH2', behavior: ['b.ts: + if (y) z()'] },
      ],
      [
        { ref: 'abc1234', text: 'feat: things' },
        { ref: 'abc1234#1', text: 'Retries the upload on a 503 reply.' },
        { ref: 'abc1234#2', text: 'Logs each retry with its delay.' },
      ],
      { 'abc1234#1': ['H1'], 'abc1234#2': ['H1'] },
      [
        { hunk: 'H1', change: 'CH1' },
        { hunk: 'H2', change: 'CH2' },
      ],
    );
    expect(rows).toEqual([
      {
        ref: 'B1',
        change: 'CH1',
        text: 'Retries the upload on a 503 reply.',
        from: 'abc1234#1',
      },
      { ref: 'B2', change: 'CH2', text: 'b.ts: + if (y) z()', from: 'behavior' },
      {
        ref: 'B3',
        change: 'CH1',
        text: 'Logs each retry with its delay.',
        from: 'abc1234#2',
      },
    ]);
  });
});

describe('new limit generators', () => {
  const base = [
    N('Session', 'h:a', { band: 'included', invoked: [], lateCmds: [], failedCmds: [] }),
    N('Commit', 'abc123def4567', { subject: 's', body: null, t: t(5) }),
  ];
  const hunk = (props: Record<string, any>) => ({
    hunk: 'H1',
    change: 'CH1',
    file: 'src/a.ts',
    ...props,
  });
  test('no push and no tag for a version bump, in the session logs', () => {
    const rows = withGraph(graphOf(base), (g) =>
      sessionEndRows(g, [
        hunk({ file: 'package.json', pairs: ['"version": "1.2.0" → "1.3.0"'] }),
      ]),
    );
    expect(rows.map((r) => r.limit)).toEqual([
      'The session logs show no push of these commits, so push and CI results for the final head are not in them.',
      'The diff bumps the version (1.2.0 → 1.3.0), but no tag or release appears in the session logs.',
    ]);
  });
  test("a docs line requiring another tool's version is no bump", () => {
    const rows = withGraph(graphOf(base), (g) =>
      sessionEndRows(g, [
        hunk({
          file: 'README.md',
          pairs: ['Requires examplelib 0.5.0 → Requires examplelib 0.5.1'],
        }),
      ]),
    );
    expect(rows.map((r) => r.limit).join('\n')).not.toContain('tag or release');
  });
  test('a changelog entry under "Unreleased" announces no release', () => {
    const rows = withGraph(graphOf(base), (g) =>
      sessionEndRows(g, [
        hunk({ file: 'CHANGELOG.md', code: ['+ ## Unreleased', '+ - adds x'] }),
      ]),
    );
    expect(rows.map((r) => r.limit).join('\n')).not.toContain('tag or release');
  });
  test('no session: no rows', () => {
    expect(withGraph(graphOf([base[1]!]), (g) => sessionEndRows(g, [hunk({})]))).toEqual(
      [],
    );
  });
  test('code no test file names, only when the scan looked for every term', () => {
    const scan = (tested: string[]) =>
      N('HeadRef', 'HR1', {
        kind: 'test scan',
        terms: ['retryUpload', 'uploader'],
        tested,
      });
    const changes = [{ change: 'CH1' }];
    const hunks = [
      {
        hunk: 'H1',
        change: 'CH1',
        file: 'src/uploader.ts',
        fresh: ['retryUpload'],
        symbols: [],
      },
    ];
    const role = new Map([['src/uploader.ts', 'behavior']]);
    const rows = withGraph(graphOf([scan([])]), (g) =>
      untestedRows(g, changes, hunks, role),
    );
    expect(rows.map((r) => r.limit)).toEqual([
      'No test file names src/uploader.ts or `retryUpload`, so no changed or existing test refers to this code by name or import.',
    ]);
    expect(
      withGraph(graphOf([scan(['uploader'])]), (g) =>
        untestedRows(g, changes, hunks, role),
      ),
    ).toEqual([]);
    // A term the scan didn't look for: no claim.
    const more = [{ ...hunks[0]!, fresh: ['retryUpload', 'backoffDelay'] }];
    expect(
      withGraph(graphOf([scan([])]), (g) => untestedRows(g, changes, more, role)),
    ).toEqual([]);
    // No scan: no claim; a unit a changed test names: none.
    expect(withGraph(graphOf([]), (g) => untestedRows(g, changes, hunks, role))).toEqual(
      [],
    );
    expect(
      withGraph(graphOf([scan([])]), (g) =>
        untestedRows(g, [{ change: 'CH1', checkedBy: ['T1: retries'] }], hunks, role),
      ),
    ).toEqual([]);
  });
  test('the test scan records terms looked for and those test files name', () => {
    const g = graphOf([
      N('File', 'src/uploader.ts', { role: 'behavior' }),
      N('Hunk', 'H1', {
        file: 'src/uploader.ts',
        fresh: ['retryUpload'],
        touched: [],
        symbols: ['retryUpload'],
      }),
    ]);
    const node = testScanNode(g, () => [
      { file: 'tests/uploader.test.ts', line: 3, term: 'uploader' },
      { file: 'src/main.ts', line: 9, term: 'retryUpload' },
    ]);
    expect(node?.props).toEqual({
      kind: 'test scan',
      terms: ['retryUpload', 'uploader'],
      tested: ['uploader'],
    });
  });
});

describe('entry row: the decision logic, not a callback inside it', () => {
  test("a callback defined inside a function doesn't take the function's lines", () => {
    const patch = [
      'diff --git a/src/upgrade.ts b/src/upgrade.ts',
      '--- /dev/null',
      '+++ b/src/upgrade.ts',
      '@@ -0,0 +1,14 @@',
      '+export async function maybeOffer(options) {',
      '+  const offer = readConfig();',
      '+  if (!offer) return false;',
      '+  const result = await runBulk({',
      '+    onRunCreated(runId) {',
      '+      setOffer({ ...offer, runId });',
      '+    },',
      '+  });',
      '+  if (result.cancelled) {',
      '+    setOffer({ ...offer, status: "declined" });',
      '+  }',
      '+  setOffer({ ...offer, status: "done" });',
      '+  return true;',
      '+}',
    ].join('\n');
    const [h] = patchHunks(patch);
    const lines = Object.fromEntries(
      (h!.fnLines ?? []).map((x) => x.split(': ')).map(([k, v]) => [k, Number(v)]),
    );
    expect(lines.maybeOffer).toBeGreaterThan(lines.onRunCreated ?? 0);
    expect(lines.onRunCreated).toBeLessThanOrEqual(2);
  });

  test("a multi-line signature's `): T {` opens the body, not ends it", () => {
    const patch = [
      'diff --git a/src/u.ts b/src/u.ts',
      '--- /dev/null',
      '+++ b/src/u.ts',
      '@@ -0,0 +1,7 @@',
      '+export async function updateCmd(',
      '+  opts: Opts,',
      '+): Promise<void> {',
      '+  const channel = opts.channel;',
      '+  if (!channel) throw new Error("x");',
      '+  await apply(channel);',
      '+}',
    ].join('\n');
    const [h] = patchHunks(patch);
    // Before the fix only the first two lines counted.
    expect(
      Number(h!.fnLines!.find((x) => x.startsWith('updateCmd:'))!.split(': ')[1]),
    ).toBeGreaterThanOrEqual(6);
  });

  test('an on*/set* callback is never the entry, even when it calls the most', () => {
    const files = ['src/upgrade.ts', 'src/config.ts', 'src/bulk.ts'].map((f) =>
      N('File', f, { role: 'behavior', inPr: true }),
    );
    const H = (id: string, file: string, props: Record<string, any>) =>
      N('Hunk', id, {
        file,
        diff: `diff:${id.slice(1)}0-${id.slice(1)}9`,
        symbols: [],
        touched: [],
        fresh: [],
        branches: 0,
        code: [],
        ...props,
      });
    const hunks = [
      H('H1', 'src/upgrade.ts', {
        scope: null,
        symbols: ['maybeOffer', 'onRunCreated'],
        fnLines: ['maybeOffer: 8', 'onRunCreated: 9'],
        owns: ['maybeOffer', 'onRunCreated'],
        branches: 3,
        code: [
          '+ const offer = readConfig();',
          '+ setOffer(offer);',
          '+ await runBulk({ onRunCreated });',
        ],
      }),
      H('H2', 'src/config.ts', {
        symbols: ['readConfig', 'setOffer'],
        fresh: ['readConfig', 'setOffer'],
        fnLines: ['readConfig: 3', 'setOffer: 3'],
        owns: ['readConfig', 'setOffer'],
      }),
      H('H3', 'src/bulk.ts', {
        symbols: ['runBulk'],
        fresh: ['runBulk'],
        fnLines: ['runBulk: 5'],
        owns: ['runBulk'],
      }),
      H('H4', 'src/upgrade.ts', {
        scope: 'maybeOffer',
        touched: ['maybeOffer'],
        fnLines: ['maybeOffer: 4'],
        owns: ['maybeOffer'],
        code: ['+ setOffer(x); readConfig(); runBulk(y)'],
      }),
    ];
    const rels = [
      ...hunks.map((h) => R('OF', ['Hunk', h.id], ['File', String(h.props.file)])),
      ...hunks.map((h) => R('HAS', ['Change', 'CH1'], ['Hunk', h.id])),
    ];
    const row = withGraph(
      graphOf(
        [...files, N('Change', 'CH1', { key: 'commit:abc', files: [] }), ...hunks],
        rels,
      ),
      (g) => entryRow(g),
    );
    expect(String(row?.fact)).toMatch(/^Start at `maybeOffer` in src\/upgrade\.ts/);
  });
});

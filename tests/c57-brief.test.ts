import { describe, expect, test } from 'bun:test';
import { commitMoments } from '../src/correlate/correlate.ts';
import {
  gitOperations,
  headLogCount,
  heredocSubject,
} from '../src/correlate/gitEvidence.ts';
import {
  commandRuns,
  passingRunnerOs,
  scriptOutcome,
  scriptPath,
} from '../src/digest/build.ts';
import { commentOrTestOnly, scriptInterface } from '../src/graph/build.ts';
import { entryRow, environmentRows } from '../src/graph/briefExtras.ts';
import { validationSection } from '../src/graph/briefRender.ts';
import { withGraph } from '../src/graph/engine.ts';
import { GRAPH_SCHEMA, type EvidenceGraph } from '../src/graph/model.ts';
import { briefParts, planDesignRows } from '../src/graph/queries.ts';
import { userInputQuestions } from '../src/integrations/codex/trace.ts';
import type { TraceRecord } from '../src/trace/types.ts';
import { openSegments, wrappedCommand } from '../src/util/shell.ts';

const N = (label: any, id: string, props: Record<string, any>) => ({ label, id, props });
const R = (type: any, from: [any, string], to: [any, string], props?: any) => ({
  type,
  from: { label: from[0], id: from[1] },
  to: { label: to[0], id: to[1] },
  ...(props ? { props } : {}),
});
const graphOf = (nodes: any[], rels: any[] = []): EvidenceGraph => ({
  schema: GRAPH_SCHEMA,
  nodes,
  rels,
  stats: { nodes: 0, rels: 0, hunks: 0, linkedHunks: 0, edits: 0, deadEndEdits: 0 },
});
const hunkNode = (id: string, file: string, props: Record<string, any> = {}) =>
  N('Hunk', id, {
    file,
    start: 1,
    end: 9,
    added: 5,
    removed: 1,
    diff: `diff:${id.slice(1)}0-${id.slice(1)}9`,
    scope: null,
    symbols: [],
    touched: [],
    fresh: [],
    branches: 0,
    pairs: [],
    conds: [],
    tests: [],
    words: [],
    code: [],
    ...props,
  });
const fileNode = (id: string, role = 'behavior', extra: Record<string, any> = {}) =>
  N('File', id, { role, inPr: true, added: 5, removed: 1, unmatched: 0, ...extra });
const change = (id: string, files: string[]) =>
  N('Change', id, {
    key: `dir:${id}`,
    files,
    roles: [],
    symbols: [],
    added: 5,
    removed: 1,
    branches: 0,
  });
const rows = (
  sections: { title: string; rows: Record<string, unknown>[] }[],
  t: string,
) => sections.find((s) => s.title === t)?.rows ?? [];

describe('commits made from another worktree', () => {
  const sha = 'c088a541216b913d788011b48b819e5037fba483';
  const cmd = (c: string, output: string): TraceRecord => ({
    kind: 'command',
    cmd: c,
    cwd: '/repo',
    output,
    isError: false,
    ts: '2026-01-01T00:00:00Z',
  });
  test('a heredoc message (`git commit -F - <<EOF`) gives the subject', () => {
    const c =
      "cd /wt && git add -A && git commit -q -F - <<'EOF'\nfix(sql): keep the order\n\nbody\nEOF\ngit status";
    const op = gitOperations(c, '/repo').find((o) => o.verb === 'commit')!;
    expect(heredocSubject(c, op)).toBe('fix(sql): keep the order');
    const found = commitMoments(
      [cmd(c, 'M  a.ts')],
      [{ sha, subject: 'fix(sql): keep the order' }],
      ['/wt'],
    );
    expect(found.has(sha)).toBe(true);
  });
  test('`git commit … && git log --oneline -N`: the first log line is the new commit', () => {
    const c =
      'cd /wt && bun test x | grep pass; git commit -q -C abc1234 --reset-author && git log --oneline -3';
    const ops = gitOperations(c, '/repo');
    expect(
      headLogCount(
        c,
        ops,
        ops.find((o) => o.verb === 'commit')!,
      ),
    ).toBe(3);
    const out = ' 7 pass\n 0 fail\nc088a54 fix: x\n63e5c1f fix: y\n9793709 feat: z\n';
    const found = commitMoments(
      [cmd(c, out)],
      [
        { sha, subject: 'unrelated subject here' },
        {
          sha: '63e5c1f0000000000000000000000000000000000',
          subject: 'other subject here',
        },
      ],
      ['/wt'],
    );
    expect([...found.keys()]).toEqual([sha]);
    // A log not joined by && (it may show an older HEAD) proves nothing.
    const loose = c.replace(' && git log', '; git log');
    expect(
      commitMoments(
        [cmd(loose, out)],
        [{ sha, subject: 'unrelated subject here' }],
        ['/wt'],
      ).size,
    ).toBe(0);
  });
});

describe('no matched session', () => {
  test('one sources row, no session row and no "unknown checks" limit', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts'),
        hunkNode('H1', 'src/a.ts', { code: ['+ return 1;'] }),
        change('CH1', ['src/a.ts']),
        N('Commit', 'abcdef123456', { subject: 'feat: a', body: null, t: '1' }),
      ],
      [
        R('OF', ['Hunk', 'H1'], ['File', 'src/a.ts']),
        R('HAS', ['Change', 'CH1'], ['Hunk', 'H1']),
      ],
    );
    const { sections } = withGraph(graph, (g) => briefParts(g));
    const process = rows(sections, 'process');
    expect(process.map((r) => r.kind)).toEqual(['sources']);
    expect(String(process[0]!.fact)).toBe(
      'The description draws on the diff and commit messages.',
    );
    expect(
      rows(sections, 'limits').some((r) => /session was matched/.test(String(r.limit))),
    ).toBe(false);
  });
});

describe('comment- and test-only commits', () => {
  test('a commit touching only comments and tests changes no behavior', () => {
    expect(
      commentOrTestOnly(
        new Map([
          ['src/q.ts', ['// SQL forms order rows as the graph does', '-// old note']],
          ['tests/q.test.ts', ['expect(x).toBe(1);']],
        ]),
      ),
    ).toBe(true);
    expect(
      commentOrTestOnly(new Map([['src/q.ts', ['// note', 'return rows.sort();']]])),
    ).toBe(false);
    expect(commentOrTestOnly(new Map([['scripts/x.sh', ['# explain']]]))).toBe(true);
  });
  test('its hunks give no was/before, and a doNotSay row names it', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts'),
        hunkNode('H1', 'src/a.ts', { pairs: ['a → b'], before: ['return a;'] }),
        change('CH1', ['src/a.ts']),
        N('Commit', 'abcdef123456', {
          subject: 'docs: note',
          body: null,
          t: '1',
          noBehavior: true,
        }),
      ],
      [
        R('OF', ['Hunk', 'H1'], ['File', 'src/a.ts']),
        R('HAS', ['Change', 'CH1'], ['Hunk', 'H1']),
        R('INTRODUCED', ['Commit', 'abcdef123456'], ['Hunk', 'H1'], { lines: 1 }),
      ],
    );
    const { sections } = withGraph(graph, (g) => briefParts(g));
    const ch = rows(sections, 'changes')[0]!;
    expect(ch.was).toEqual([]);
    expect(ch.before ?? null).toBeNull();
    expect(rows(sections, 'doNotSay')).toContainEqual({
      kind: 'no behavior change',
      text: "commit abcdef123456 only adds comments/tests; it doesn't change behavior.",
      cites: ['abcdef123456'],
    });
  });
});

describe('remote CI runs as platform evidence', () => {
  test('runner labels of passing jobs, from the last refresh of a watched look', () => {
    const out =
      'Some checks are still pending\n✓  CI/check (macos-latest) 33s\n*  CI/check (windows-latest...\n' +
      'All checks were successful\n✓  CI/check (macos-latest) 33s\n✓  CI/check (windows-latest... 1m22s\n';
    expect(passingRunnerOs(out)).toEqual(['Windows', 'macOS']);
    expect(
      passingRunnerOs('X build (windows-latest) failed\n✓ build (ubuntu-latest) in 2m'),
    ).toEqual(['Linux']);
  });
  test('a platform that passed in CI after the last edit has no platform-not-run row', () => {
    const hunks = [
      {
        change: 'CH1',
        file: 'src/a.ts',
        code: ["+ if (process.platform === 'win32') return x;"],
        conds: [],
      },
    ];
    const roles = new Map([['src/a.ts', 'behavior']]);
    const host = { platform: 'linux', arch: 'x64' };
    const edits = new Map([['src/a.ts', '2026-01-01T00:00:05Z']]);
    const windows = (ci: { os: string[]; t: string }[]) =>
      environmentRows(hunks, roles, host, undefined, false, ci, edits).some((r) =>
        /Windows/.test(String(r.limit)),
      );
    expect(windows([])).toBe(true);
    expect(windows([{ os: ['Windows'], t: '2026-01-01T00:00:09Z' }])).toBe(false);
    // A run before the last edit didn't run the final code.
    expect(windows([{ os: ['Windows'], t: '2026-01-01T00:00:01Z' }])).toBe(true);
  });
});

describe('answered questions', () => {
  test('request_user_input answers become decision questions', () => {
    const args = {
      questions: [
        {
          id: 'ci',
          question: 'When should it run?',
          options: [{ label: 'Every PR' }, { label: 'Nightly' }],
        },
      ],
    };
    expect(
      userInputQuestions(args, '{"answers":{"ci":{"answers":["Every PR"]}}}'),
    ).toEqual([
      {
        question: 'When should it run?',
        options: ['Every PR', 'Nightly'],
        answer: 'Every PR',
        ownWords: false,
      },
    ]);
  });
});

describe('script-driven checks through wrappers', () => {
  test('wrappers open to the command they run', () => {
    expect(
      wrappedCommand(
        "docker run --rm --entrypoint /bin/sh -v /a:/src img -c 'xvfb-run -a bun x.ts'",
      ),
    ).toBe('xvfb-run -a bun x.ts');
    expect(
      openSegments("docker run img -c 'bunx tsc -p . && bun test'").map((s) => s.command),
    ).toEqual(['bunx tsc -p .', 'bun test']);
    expect(wrappedCommand('bash -lc "cd /x && bun test"')).toBe('cd /x && bun test');
    expect(wrappedCommand('grep -c foo x')).toBeUndefined();
  });
  test("a run of the PR's own script is a check with its tally", () => {
    expect(scriptPath('bun scripts/walk.ts --binary b')).toBe('scripts/walk.ts');
    const runs = commandRuns(
      "docker run --rm --entrypoint /bin/sh -w /src img -c 'xvfb-run -a bun scripts/walk.ts --report r.json'",
      false,
      'PASS walk: 163/163 steps, 2/2 smokes. Report: r.json',
      (p) => p === 'scripts/walk.ts',
    );
    expect(runs).toEqual([
      {
        cmd: 'bun scripts/walk.ts --report r.json',
        kind: 'test',
        outcome: 'passed',
        basis: 'exit status',
        summary: ['PASS walk: 163/163 steps, 2/2 smokes. Report: r.json'],
        sole: true,
      },
    ]);
    // Not a PR script: not a check.
    expect(
      commandRuns('bun scripts/other.ts', false, 'ok', (p) => p === 'scripts/walk.ts'),
    ).toEqual([]);
    // Checks inside a container are checks too.
    expect(
      commandRuns(
        "docker run img -c 'bunx tsc -p tsconfig.json && bun test'",
        false,
        ' 5 pass\n 0 fail',
      ).map((r) => r.kind),
    ).toEqual(['typecheck', 'test']);
  });
  test('with no exit status, the tally decides', () => {
    expect(scriptOutcome(undefined, '151/163 steps, 0/2 smokes').outcome).toBe('failed');
    expect(scriptOutcome(undefined, '163/163 steps, 2/2 smokes').outcome).toBe('passed');
    expect(scriptOutcome(undefined, 'done').outcome).toBe('unknown');
  });
});

describe("a new script's interface", () => {
  test('every flag it parses with its default, and its pass/fail lines', () => {
    expect(
      scriptInterface([
        'const args = process.argv.slice(2);',
        'const binary = resolve(value("--binary") ?? (target ? join("bin", n) : "bin/x"));',
        'const report = value("--report") ?? "out/report.json";',
        'const skip = args.includes("--skip-smoke");',
        'if (proc.exitCode === null) stop(proc);',
        'console.log(`${ok ? "PASS" : "FAIL"} walk: ${n} steps`);',
        'if (!ok) process.exitCode = 1;',
      ]),
    ).toEqual([
      '--binary (default (target ? join("bin", n) : "bin/x"))',
      '--report (default "out/report.json")',
      '--skip-smoke',
      'pass/fail: console.log(`${ok ? "PASS" : "FAIL"} walk: ${n} steps`);',
      'pass/fail: if (!ok) process.exitCode = 1;',
    ]);
  });
});

describe('plan vs code', () => {
  test('a plan sentence naming a design gets a "describe what the code does" row', () => {
    const sections = [
      {
        title: 'background',
        columns: [],
        rows: [
          {
            ref: 'P1',
            kind: "plan that this PR's request to carry out the plan refers to",
            text: '# Walk ## Summary - Add a harness that runs every step, using one persistent workspace per book. - Keep the docs short.',
          },
        ],
      },
    ];
    expect(planDesignRows(sections as any)).toEqual([
      {
        kind: 'plan, not code',
        text: 'the plan said "Add a harness that runs every step, using one persistent workspace per book."; describe what the code does, from the change rows, not the plan.',
        cites: ['P1'],
      },
    ]);
  });
});

describe('entry ranking', () => {
  test('a getter reading the selecting environment variable is not preferred as the entry (c58)', () => {
    const files = [fileNode('src/store.ts'), fileNode('src/evidence.ts')];
    const hunks = [
      hunkNode('H1', 'src/store.ts', {
        symbols: ['engineName', 'openStore'],
        touched: ['engineName', 'openStore'],
        fresh: ['engineName', 'openStore'],
        owns: ['openStore'],
        readers: ['engineName'],
        fnWords: [
          'engineName: export function engine name return process env engine sqlite',
          'openStore: open store',
        ],
      }),
      hunkNode('H2', 'src/evidence.ts', {
        scope: 'saveGraph',
        touched: ['saveGraph'],
        owns: ['saveGraph'],
        code: ["+ if (engineName() === 'sqlite') openStore(x);"],
      }),
    ];
    const rels = [
      ...hunks.map((h) => R('OF', ['Hunk', h.id], ['File', String(h.props.file)])),
      ...hunks.map((h) => R('HAS', ['Change', 'CH1'], ['Hunk', h.id])),
    ];
    const row = withGraph(graphOf([...files, ...hunks, change('CH1', [])], rels), (g) =>
      entryRow(g),
    );
    expect(String(row?.fact)).not.toContain('reads the setting');
    expect(String(row?.fact)).not.toStartWith('Start at `engineName`');
  });
});

describe('the Validation section', () => {
  test('never names the tool; fresh and session runs on separate lines with their source', () => {
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
              outcome: 'passed',
              result: '9 pass; 0 fail',
              when: 'fresh',
              cmd: 'bun test',
            },
            {
              check: 'R3',
              kind: 'typecheck',
              outcome: 'passed',
              result: 'exit 0, no output',
              when: 'after the last edit the logs captured',
              editedAfter: [],
              cmd: 'bun run typecheck',
              statable: true,
            },
          ],
        },
      ],
    } as any);
    expect(section).not.toMatch(/tracetoon/i);
    expect(section).toContain(
      '- `bun test`: passed (9 pass, 0 fail), run on the submitted content.',
    );
  });
});

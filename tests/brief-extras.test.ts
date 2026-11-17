import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyBrief,
  misattributedTests,
  misplacedFocus,
  staleNoPass,
} from '../src/graph/briefRender.ts';
import {
  capLimits,
  entryRow,
  failedPublishRows,
  functionProfiles,
  noPassAfterCommitRow,
  remotePathRows,
  environmentRows,
  type LiveEvidence,
} from '../src/graph/briefExtras.ts';
import { invocationsOf } from '../src/digest/build.ts';
import {
  patchHunks,
  splitScriptUnits,
  unitRole,
  type PatchHunk,
} from '../src/graph/build.ts';
import { withGraph } from '../src/graph/engine.ts';
import { GRAPH_SCHEMA, type EvidenceGraph } from '../src/graph/model.ts';
import { briefParts } from '../src/graph/queries.ts';

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
const fileNode = (id: string, role = 'behavior') =>
  N('File', id, { role, inPr: true, added: 5, removed: 1, unmatched: 0 });

describe('open points promoted into limits', () => {
  test('no pass after the last commit: a limit when every pass came before it', () => {
    // An edit of a PR file after the last pass and before the commit.
    const edited = (at: number) => [
      N('Session', 'h:a', { band: 'included' }),
      fileNode('src/a.ts'),
      N('Edit', 'E1', { t: t(at), file: 'src/a.ts', inPr: true }),
    ];
    const editRels = [
      R('EDITS', ['Edit', 'E1'], ['File', 'src/a.ts']),
      R('IN_SESSION', ['Edit', 'E1'], ['Session', 'h:a']),
    ];
    const commit = N('Commit', 'abc123def4567', { subject: 's', body: null, t: t(5) });
    const g = graphOf([commit, ...edited(4)], editRels);
    const runs = [
      { id: 'R1', kind: 'test', outcome: 'passed', t: t(3) },
      { id: 'R2', kind: 'lint', outcome: 'passed', t: t(3) },
    ];
    expect(withGraph(g, (e) => noPassAfterCommitRow(e, runs))).toEqual({
      change: null,
      kind: 'open',
      limit:
        'No passing check run was recorded after the last commit (abc123def456); the last pass (R1, test) came before it, and src/a.ts changed between them.',
    });
    // A pass with no captured edit between it and the commit: no open point
    // (a "historical session run" row beside "nothing changed" invited hedging).
    expect(withGraph(graphOf([commit]), (e) => noPassAfterCommitRow(e, runs))).toBeUndefined();
    expect(
      withGraph(graphOf([commit, ...edited(2)], editRels), (e) =>
        noPassAfterCommitRow(e, runs),
      ),
    ).toBeUndefined();
    // A pass after the commit closes it; no runs or no commit say nothing.
    expect(
      withGraph(g, (e) =>
        noPassAfterCommitRow(e, [
          ...runs,
          { id: 'R3', kind: 'test', outcome: 'passed', t: t(6) },
        ]),
      ),
    ).toBeUndefined();
    expect(withGraph(g, (e) => noPassAfterCommitRow(e, []))).toBeUndefined();
    expect(withGraph(graphOf([]), (e) => noPassAfterCommitRow(e, runs))).toBeUndefined();
  });

  test('a failed publishing command is an open point; other failures are not', () => {
    const g = graphOf([
      N('Session', 'h:a', {
        band: 'included',
        agent: 'Claude Code',
        failedCommands: 4,
        failedCommand: 'python',
        failedCmds: [
          'python (failed 2 of 5)',
          'gh pr (failed 1 of 1)',
          'git push (failed 1 of 3)',
          'gh auth (failed 1 of 1)',
        ],
      }),
      N('Session', 'h:b', {
        band: 'ambiguous',
        agent: 'Codex',
        failedCmds: ['npm publish (failed 1 of 1)'],
      }),
    ]);
    expect(withGraph(g, (e) => failedPublishRows(e)).map((r) => r.limit)).toEqual([
      "`gh pr` failed in the Claude Code session; whether or how the work was then published or pushed isn't recorded.",
      "`git push` failed 1 of 3 times in the Claude Code session; which attempt published or pushed what isn't recorded.",
    ]);
    // Older graphs carry only the most frequent failure.
    const old = graphOf([
      N('Session', 'h:a', {
        band: 'included',
        agent: 'Codex',
        failedCommand: 'git push',
      }),
    ]);
    expect(withGraph(old, (e) => failedPublishRows(e))).toHaveLength(1);
  });

  test('added branches in remote-call code no run names are open; local code is not', () => {
    const roles = new Map([
      ['src/net/providers.ts', 'behavior'],
      ['src/util/shell.ts', 'behavior'],
      ['scripts/upload.ts', 'behavior'],
    ]);
    const hunks = [
      {
        change: 'CH1',
        file: 'src/net/providers.ts',
        branches: 3,
        symbols: ['callOpenai', 'run'],
        words: ['fetch', 'json', 'openai'],
      },
      // Branches but no remote call.
      {
        change: 'CH2',
        file: 'src/util/shell.ts',
        branches: 4,
        symbols: ['splitCommands'],
        words: ['quote'],
      },
      // A script, not shipped source.
      {
        change: 'CH3',
        file: 'scripts/upload.ts',
        branches: 2,
        symbols: [],
        words: ['fetch'],
      },
    ];
    expect(remotePathRows(hunks, roles, [])).toEqual([
      {
        change: 'CH1',
        kind: 'open',
        limit:
          'src/net/providers.ts adds branches that call a remote service (`callOpenai`); no recorded check run shows those paths running against the real service.',
      },
    ]);
    // A run whose command names the file covers it.
    expect(
      remotePathRows(hunks, roles, [{ cmd: 'bun test tests/providers.test.ts' }]),
    ).toEqual([]);
  });

  test('over the cap, remote rows, then the no-request row give way first', () => {
    const row = (limit: string) => ({ change: null, kind: 'open', limit });
    const existing = [1, 2, 3, 4].map((i) => row(`existing ${i}`));
    existing.splice(2, 0, row('No user request was recorded for CH2.'));
    const extra = [row('no pass'), row('gh failed')];
    const remote = [row('remote')];
    const out = capLimits(existing, extra, remote, 6);
    expect(out.map((r) => r.limit)).toEqual([
      'existing 1',
      'existing 2',
      'existing 3',
      'existing 4',
      'no pass',
      'gh failed',
    ]);
    expect(capLimits([row('a')], [row('b')], remote)).toHaveLength(3);
  });

  test('environment rows: other-OS branches, faked steps, terminal paths', () => {
    const roles = new Map([
      ['src/launch.ts', 'behavior'],
      ['src/ui.ts', 'behavior'],
      ['tests/launch.test.ts', 'tests'],
    ]);
    const hunks = [
      {
        change: 'CH1',
        file: 'src/launch.ts',
        code: ["+ if (process.platform === 'win32') return runCmd(exe);"],
        conds: [],
      },
      {
        change: 'CH2',
        file: 'src/ui.ts',
        code: ['+ if (!process.stdout.isTTY) return plain(text);'],
        conds: [],
      },
      {
        change: 'CH1',
        file: 'tests/launch.test.ts',
        code: ['+ const spawn = mock(() => ({ status: 0 })); // fake spawnSync'],
        conds: [],
      },
    ];
    const rows = environmentRows(hunks, roles, { platform: 'linux', arch: 'x64' });
    expect(rows.map((r) => r.limit)).toEqual([
      "src/launch.ts changes Windows-specific code (`if (process.platform === 'win32') return runCmd(exe);`); the recorded runs were on linux/x64, so none shows the Windows path running.",
      'The changed tests (tests/launch.test.ts) replace spawned processes with fakes or stubs: they check the logic around those steps, not the real step.',
      'src/ui.ts changes interactive (terminal/TTY) handling; recorded checks run without a terminal, so none shows that path with a user at the keyboard.',
    ]);
    // On the platform the code branches for, no OS row.
    expect(
      environmentRows(hunks, roles, { platform: 'win32', arch: 'x64' }).some((r) =>
        /Windows/.test(String(r.limit)),
      ),
    ).toBe(false);
  });
});

describe('platform, script and fake rows', () => {
  const host = { platform: 'linux', arch: 'x64' };
  const roles = new Map([
    ['src/a.ts', 'behavior'],
    ['src/b.ts', 'behavior'],
    ['src/digest.ts', 'behavior'],
    ['packaging/signing.xml', 'config'],
    ['scripts/build-win.ps1', 'behavior'],
    ['scripts/build.sh', 'behavior'],
    ['.github/workflows/release.yml', 'config'],
    ['tests/a.test.ts', 'tests'],
    ['src/run/fake-gh.ts', 'behavior'],
  ]);
  const h = (change: string, file: string, code: string[]) => ({ change, file, code, conds: [] });

  test('only lines that test the platform count; one row per change unit, merged', () => {
    const rows = environmentRows(
      [
        // A platform name mapped to an asset suffix is not a branch.
        h('CH1', 'src/a.ts', ["+ const os = win ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';"]),
        h('CH1', 'src/a.ts', ['+ return platform === "win32" ? "windows" : platform;']),
        // A `.cmd` property and a config file naming a platform are not either.
        h('CH2', 'src/digest.ts', ['+ const key = commandKey(r.cmd);', '+ if (run.cmd) out.push(x);']),
        h('CH3', 'packaging/signing.xml', ['+ <file path="app-windows-arm64.exe" />']),
        // Real branches, two platforms in one unit: one row.
        h('CH4', 'src/b.ts', [
          "+ if (process.platform === 'win32') return spawnWin(cmd);",
          "+ if (process.arch === 'arm64') flags.push('--arm');",
        ]),
      ],
      roles,
      host,
    );
    expect(rows.map((r) => [r.change, r.limit])).toEqual([
      [
        'CH4',
        "src/b.ts changes Windows and arm64-specific code (`if (process.platform === 'win32') return spawnWin(cmd);`); the recorded runs were on linux/x64, so none shows the Windows and arm64 paths running.",
      ],
    ]);
  });

  test('a Windows script and a workflow runner pick are platform-specific', () => {
    const rows = environmentRows(
      [
        h('CH1', 'scripts/build-win.ps1', ['+ if ($LASTEXITCODE -ne 0) { exit 1 }']),
        h('CH2', '.github/workflows/release.yml', ['+ runs-on: windows-latest', '+ name: Sign']),
      ],
      roles,
      host,
    );
    expect(rows.map((r) => r.change)).toEqual(['CH1', 'CH2']);
    expect(String(rows[0]!.limit)).toStartWith('scripts/build-win.ps1 changes Windows-specific code;');
    expect(String(rows[1]!.limit)).toContain('(`runs-on: windows-latest`)');
  });

  test('changed scripts and workflows no session command ran', () => {
    const hunks = [
      h('CH1', 'scripts/build-win.ps1', ['+ Write-Host done']),
      h('CH1', 'scripts/build.sh', ['+ echo done']),
      h('CH2', '.github/workflows/release.yml', ['+ name: Publish']),
    ];
    const limits = (ran?: string[]) =>
      environmentRows(hunks, roles, host, ran)
        .map((r) => String(r.limit))
        .filter((l) => !/-specific/.test(l));
    expect(limits(['bash scripts/build.sh', 'bun test'])).toEqual([
      'scripts/build-win.ps1 is a changed script no recorded session command ran; only the diff shows it.',
      '.github/workflows/release.yml changes CI workflow; workflows run in CI, and no run of it is in the logs Tracetoon read.',
    ]);
    // No session matched: nothing to compare with, no script rows.
    expect(limits(undefined)).toEqual([]);
    // CI results in the logs (any commit of the PR) are runs of the workflows.
    expect(
      environmentRows(hunks, roles, host, ['bash scripts/build.sh'], true).some((r) =>
        /CI workflow/.test(String(r.limit)),
      ),
    ).toBe(false);
  });

  test('only runnable entry points count as scripts; modules tests drive do not', () => {
    const rows = environmentRows(
      [
        // A library module under scripts/: imported, never run on its own.
        h('CH1', 'scripts/lib/e2e-oracle.ts', ['+ export function judge() {}']),
        // A test drives this one by name.
        { ...h('CH1', 'scripts/lib/e2e-cases.sh', ['+ echo case']) },
        h('CH2', 'tests/e2e-cases.test.ts', ["+ const cases = load('scripts/lib/e2e-cases.sh');"]),
        // Entry points: a shebang, a package.json script target.
        { ...h('CH3', 'bin/release', ['+ #!/usr/bin/env bash', '+ set -e']), shebang: true },
        h('CH3', 'tools/gen.ts', ['+ main();']),
        h('CH4', 'package.json', ['+ "gen": "bun tools/gen.ts",']),
      ],
      new Map([
        ...roles,
        ['scripts/lib/e2e-oracle.ts', 'scripts'],
        ['scripts/lib/e2e-cases.sh', 'scripts'],
        ['tests/e2e-cases.test.ts', 'tests'],
        ['bin/release', 'scripts'],
        ['tools/gen.ts', 'scripts'],
        ['package.json', 'config'],
      ]),
      host,
      ['bun test'],
    );
    expect(rows.map((r) => String(r.limit)).filter((l) => /changed script/.test(l))).toEqual([
      'bin/release, tools/gen.ts are changed scripts no recorded session command ran; only the diff shows them.',
    ]);
  });

  test('fakes are named, with the change unit they stand in for', () => {
    const rows = environmentRows(
      [
        h('CH1', 'src/run/fake-github.ts', ['+ export function fakeGithub() {}']),
        { change: 'CH2', file: 'src/github.ts', code: ['+ export function github() {}'], conds: [], symbols: ['github'] },
        h('CH3', 'tests/a.test.ts', ['+ const runner = fakeRunner({ exit: 0 });']),
      ],
      new Map([...roles, ['src/github.ts', 'behavior'], ['src/run/fake-github.ts', 'behavior']]),
      host,
    );
    expect(rows.map((r) => [r.change, r.limit])).toEqual([
      [
        'CH2',
        'The changed tests (tests/a.test.ts) replace collaborators with fakes or stubs (`fake-github.ts`, `fakeRunner`); CH2 is reached that way: they check the logic around those steps, not the real steps.',
      ],
    ]);
  });
});

describe('the entry point', () => {
  const files = [
    fileNode('src/commands/comic.ts'),
    fileNode('src/comic/providers.ts'),
    fileNode('tests/comic.test.ts', 'tests'),
  ];
  const hunks = [
    hunkNode('H1', 'src/comic/providers.ts', {
      symbols: ['providerInfo', 'providerAvailable', 'generateImages', 'ProviderId'],
      fresh: ['providerInfo', 'generateImages'],
      touched: ['providerInfo', 'providerAvailable', 'generateImages'],
      code: ['+ export function providerInfo(id: ProviderId) {', '+ return castLine(x);'],
      branches: 9,
    }),
    hunkNode('H2', 'src/commands/comic.ts', {
      scope: 'chooseProvider',
      touched: ['castRefs'],
      code: [
        '+ const ready = PROVIDERS.filter(providerAvailable).map(providerInfo);',
        '- if (!providerAvailable(x))',
        '+ const id: ProviderId = pick(ready);',
      ],
      branches: 3,
    }),
    hunkNode('H3', 'tests/comic.test.ts', {
      code: ['+ providerInfo(a); providerAvailable(b); generateImages(c);'],
    }),
  ];
  const rels = [
    ...hunks.map((h) => R('OF', ['Hunk', h.id], ['File', String(h.props.file)])),
    ...hunks.map((h) =>
      R('HAS', ['Change', h.id === 'H2' ? 'CH2' : 'CH1'], ['Hunk', h.id]),
    ),
  ];
  const changes = [
    N('Change', 'CH1', {
      key: 'dir:src',
      files: [],
      roles: [],
      symbols: [],
      added: 1,
      removed: 0,
      branches: 0,
    }),
    N('Change', 'CH2', {
      key: 'dir:cmd',
      files: [],
      roles: [],
      symbols: [],
      added: 1,
      removed: 0,
      branches: 0,
    }),
  ];
  const headRef = N('HeadRef', 'HR1', {
    kind: 'most referenced',
    term: 'providerInfo',
    fresh: true,
    definedIn: ['src/comic/providers.ts'],
    refs: ['src/commands/comic.ts', 'src/commands/doctor.ts'],
    files: 2,
    count: 6,
  });

  test("the source function calling other files' changed functions, not the most referenced helper", () => {
    const row = withGraph(graphOf([...files, ...hunks, ...changes, headRef], rels), (g) =>
      entryRow(g),
    );
    // Types (`ProviderId`), constants and removed lines are not calls; tests are not entries.
    expect(row).toEqual({
      kind: 'entry',
      fact: 'Start at `chooseProvider` in src/commands/comic.ts.',
      cites: ['CH2', 'diff:20-29'],
    });
  });

  test('with no function calling across files, the most-referenced source symbol that owns added lines', () => {
    const lone = hunks.filter((h) => h.id !== 'H2');
    const row = withGraph(
      graphOf(
        [...files, ...lone, ...changes, headRef],
        rels.filter((r) => !JSON.stringify(r).includes('"H2"')),
      ),
      (g) => entryRow(g),
    );
    expect(row?.fact).toBe('Start at `providerInfo` in src/comic/providers.ts.');
  });

  test('a setter or callback is never the entry', () => {
    // The calling hunk's function is a call-through the patch adds whole.
    const thin = hunks.map((h) =>
      h.id === 'H2' ? { ...h, props: { ...h.props, thin: ['chooseProvider'] } } : h,
    );
    const row = withGraph(graphOf([...files, ...thin, ...changes, headRef], rels), (g) =>
      entryRow(g),
    );
    expect(String(row?.fact ?? '')).not.toContain('chooseProvider');
  });

  test('a most-referenced helper that owns little of the added code is no entry', () => {
    const lone = hunks.filter((h) => h.id !== 'H2');
    // The helper's hunk is small beside another source hunk it doesn't own.
    const big = hunkNode('H4', 'src/comic/render.ts', {
      scope: 'renderStrip',
      touched: ['renderStrip'],
      added: 90,
    });
    const row = withGraph(
      graphOf(
        [...files, fileNode('src/comic/render.ts'), ...lone, big, ...changes, headRef],
        [
          ...rels.filter((r) => !JSON.stringify(r).includes('"H2"')),
          R('OF', ['Hunk', 'H4'], ['File', 'src/comic/render.ts']),
          R('HAS', ['Change', 'CH1'], ['Hunk', 'H4']),
        ],
      ),
      (g) => entryRow(g),
    );
    expect(row).toBeUndefined();
  });

  test('only a function that owns changed code is named: not the one git names after the @@', () => {
    // `chooseProvider` is only the @@ context; the changed lines sit in `castRefs`.
    const owned = hunks.map((h) =>
      h.id === 'H2'
        ? { ...h, props: { ...h.props, owns: ['castRefs'] } }
        : h.id === 'H1'
          ? { ...h, props: { ...h.props, owns: ['providerInfo', 'generateImages'] } }
          : h,
    );
    const row = withGraph(graphOf([...files, ...owned, ...changes, headRef], rels), (g) =>
      entryRow(g),
    );
    expect(row?.fact).toBe('Start at `castRefs` in src/commands/comic.ts.');
    // The hunk's lines only moved: it owns nothing, and nothing else qualifies.
    const moved = owned.map((h) =>
      h.id === 'H2' ? { ...h, props: { ...h.props, owns: [] } } : h,
    );
    expect(
      withGraph(graphOf([...files, ...moved, ...changes, headRef], rels), (g) =>
        entryRow(g),
      ),
    ).toBeUndefined();
  });

  test('a most-referenced symbol is no entry when it owns no changed code or only reads a value', () => {
    const lone = hunks.filter((h) => h.id !== 'H2');
    const lonely = rels.filter((r) => !JSON.stringify(r).includes('"H2"'));
    const withOwns = (owns: string[], readers: string[] = []) =>
      lone.map((h) =>
        h.id === 'H1' ? { ...h, props: { ...h.props, owns, readers } } : h,
      );
    const entry = (hs: any[]) =>
      withGraph(graphOf([...files, ...hs, ...changes, headRef], lonely), (g) =>
        entryRow(g),
      );
    expect(entry(withOwns(['providerInfo']))?.fact).toBe(
      'Start at `providerInfo` in src/comic/providers.ts.',
    );
    expect(entry(withOwns(['generateImages']))).toBeUndefined();
    expect(entry(withOwns(['providerInfo'], ['providerInfo']))).toBeUndefined();
  });

  test('a type is never the start: the function defined in its file, else the file alone', () => {
    const lone = hunks.filter((h) => h.id !== 'H2');
    const lonely = rels.filter((r) => !JSON.stringify(r).includes('"H2"'));
    const typeRef = N('HeadRef', 'HR1', {
      ...headRef.props,
      term: 'ProviderId',
    });
    const entry = (hs: any[]) =>
      withGraph(graphOf([...files, ...hs, ...changes, typeRef], lonely), (g) =>
        entryRow(g),
      );
    // `ProviderId` is a type: the function owning most added lines there instead.
    const typed = lone.map((h) =>
      h.id === 'H1' ? { ...h, props: { ...h.props, types: ['ProviderId'] } } : h,
    );
    expect(entry(typed)?.fact).toMatch(
      /^Start at `(providerInfo|providerAvailable|generateImages)` in src\/comic\/providers\.ts/,
    );
    expect(entry(typed)?.fact).not.toContain('ProviderId');
    // Only the type is defined there: the file alone.
    const onlyType = lone.map((h) =>
      h.id === 'H1'
        ? {
            ...h,
            props: {
              ...h.props,
              symbols: ['ProviderId'],
              touched: ['ProviderId'],
              types: ['ProviderId'],
            },
          }
        : h,
    );
    expect(entry(onlyType)?.fact).toBe('Start in src/comic/providers.ts.');
  });

  test('a name the file only imports is not defined there', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,8 @@',
      ' import { x } from "./x.ts";',
      '+import {',
      '+  usageOf,',
      '+  type Usage,',
      '+} from "./usage.ts";',
      '+export interface Options { cwd?: string }',
      ' const y = 1;',
      ' ',
    ].join('\n');
    const [h] = patchHunks(patch);
    expect(h!.symbols).toEqual(['Options']);
    expect(h!.types).toEqual(['Options']);
  });

  test("a hunk's behavior belongs to the function with most of its changed lines", () => {
    const patch = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '@@ -1,4 +1,16 @@',
      '+export function setSharing(on: boolean) {',
      '+  sharing = on;',
      '+}',
      ' export function withShared(run: () => void) {',
      '-  run();',
      '+  const lease = takeLease();',
      '+  if (!lease) throw new Error("busy");',
      '+  try {',
      '+    linkLogin(lease);',
      '+    run();',
      '+  } finally {',
      '+    unlinkLogin(lease);',
      '+    lease.release();',
      '+  }',
      ' }',
    ].join('\n');
    const [h] = patchHunks(patch);
    expect(h!.fnLines).toEqual(['setSharing: 2', 'withShared: 7']);
    const node = hunkNode('H1', 'src/auth.ts', {
      symbols: h!.symbols,
      touched: h!.touched,
      owns: h!.owns,
      fnLines: h!.fnLines,
      types: h!.types,
    });
    const ctx = {
      sentences: [
        { ref: 'abc#1', text: 'Concurrent runs share one login through a lease.' },
      ],
      links: { 'abc#1': ['H1'] },
    };
    const profiles = withGraph(
      graphOf(
        [fileNode('src/auth.ts'), node],
        [R('OF', ['Hunk', 'H1'], ['File', 'src/auth.ts'])],
      ),
      (g) => functionProfiles(g, ctx),
    );
    expect(profiles.get('withShared')!.sentences.map((x) => x.ref)).toEqual(['abc#1']);
    expect(profiles.get('setSharing')!.sentences).toEqual([]);
  });

  test('moved lines are said as moved in `was`, not as a changed value', () => {
    const moved = hunks.map((h) =>
      h.id === 'H2' ? { ...h, props: { ...h.props, moved: 3 } } : h,
    );
    const p = withGraph(graphOf([...files, ...moved, ...changes], rels), (g) =>
      briefParts(g),
    );
    const was = p.sections
      .find((x) => x.title === 'changes')!
      .rows.flatMap((r) => (r.was as string[]) ?? []);
    expect(was).toEqual([
      'src/commands/comic.ts: 3 line(s) moved or reflowed, text unchanged',
    ]);
  });

  test('the brief carries it as a process row and the head scan stops calling itself the place to start', () => {
    const b = withGraph(graphOf([...files, ...hunks, ...changes, headRef], rels), (g) =>
      briefParts(g),
    );
    const process = b.sections.find((s) => s.title === 'process')!.rows;
    expect(process.find((r) => r.kind === 'entry')?.fact).toContain('`chooseProvider`');
    expect(b.sections.find((s) => s.title === 'headScan')!.rows[0]!.kind).toBe(
      'most referenced',
    );
  });
});

describe('change units split by file role', () => {
  const h = (id: string, file: string, p: Partial<PatchHunk> = {}): PatchHunk => ({
    id,
    file,
    start: 1,
    end: 2,
    added: 2,
    removed: 0,
    diff: `diff:${id}`,
    symbols: [],
    touched: [],
    branches: 0,
    fresh: [],
    pairs: [],
    dropped: [],
    conds: [],
    tests: [],
    fnWords: [],
    words: [],
    code: [],
    lines: new Set(),
    gone: new Set(),
    ...p,
  });
  const role = (f: string) =>
    f.startsWith('tests/') ? 'tests' : f.endsWith('.json') ? 'config' : 'behavior';

  test('roles: shipped source, scripts, tests, other', () => {
    expect(unitRole('src/a.ts', 'behavior')).toBe('src');
    expect(unitRole('scripts/eval.ts', 'behavior')).toBe('scripts');
    expect(unitRole('tests/a.test.ts', 'tests')).toBe('tests');
    expect(unitRole('README.md', 'docs')).toBe('other');
  });

  test('an unrelated script leaves the unit; each test goes with the code it names', () => {
    const groups = new Map([
      [
        'commit:abc',
        [
          h('H1', 'src/correlate.ts', {
            touched: ['makesCommit', 'commitMoments'],
            lines: new Set(['return makesCommit(cmd)']),
          }),
          h('H2', 'scripts/eval-summaries.ts', {
            lines: new Set(["base: 'c62818f^1',"]),
            words: ['base', 'head'],
          }),
          h('H3', 'tests/units.test.ts', {
            tests: ['commit detection'],
            words: ['commit', 'moments', 'detection'],
          }),
          h('H4', 'tests/eval.test.ts', {
            tests: ['eval summaries pin cases'],
            words: ['eval', 'summaries'],
          }),
          h('H5', 'tests/other.test.ts', { words: ['report', 'html'] }),
          h('H6', 'package.json'),
        ],
      ],
    ]);
    splitScriptUnits(groups, role);
    expect([...groups.keys()]).toEqual(['commit:abc', 'commit:abc|scripts']);
    expect(groups.get('commit:abc')!.map((x) => x.file)).toEqual([
      'src/correlate.ts',
      'tests/units.test.ts',
      'tests/other.test.ts', // a tie stays with the source
      'package.json',
    ]);
    expect(groups.get('commit:abc|scripts')!.map((x) => x.file)).toEqual([
      'scripts/eval-summaries.ts',
      'tests/eval.test.ts',
    ]);
  });

  test('a script that calls the changed source stays in the unit', () => {
    const groups = new Map([
      [
        'prompt:S1',
        [
          h('H1', 'src/shell.ts', { fresh: ['splitCommands'] }),
          h('H2', 'scripts/check.ts', {
            lines: new Set(['const parts = splitCommands(line);']),
          }),
        ],
      ],
    ]);
    splitScriptUnits(groups, role);
    expect([...groups.keys()]).toEqual(['prompt:S1']);
  });
});

describe('published bodies carry no brief refs', () => {
  const b = {
    sections: [
      { title: 'changes', columns: ['change'], rows: [{ change: 'CH1', where: [] }] },
      {
        title: 'requests',
        columns: ['ref'],
        rows: [{ ref: 'S2', kind: 'user request' }],
      },
    ],
  } as any;
  test('diff ranges, sessions, space-separated and single refs are stripped', () => {
    const body = [
      'Commands are split before matching. [CH1, diff:660-684]',
      'The user asked for it. [S2]',
      'Both rows say so. [CH1 S2]',
      'A session ref too. [S2; h:9b263cce4191]',
      'A [link](https://example.com) stays, as does [a note].',
    ].join('\n');
    const r = applyBrief(body, b);
    expect(r.text).not.toMatch(/\[(CH1|S2|diff:|h:)/);
    expect(r.text).toContain('Commands are split before matching.\n');
    expect(r.text).toContain('[link](https://example.com)');
    expect(r.text).toContain('[a note]');
    // Patch ranges and session ids are citable, not unknown refs.
    expect(r.unknownRefs).toEqual([]);
  });
  test('without a brief, tags are still stripped', () => {
    expect(applyBrief('It works. [CH1, diff:1-2]\n', undefined).text).toBe('It works.\n');
  });
});

test('drafting guidance: word target, one motive sentence, the entry row', () => {
  const drafting = readFileSync(
    resolve(import.meta.dir, '../plugin/skills/tracetoon/references/drafting.md'),
    'utf8',
  );
  expect(drafting).toContain('250–400 words for a typical PR');
  expect(drafting).toContain('up to about 600');
  // Limits keep their scope; prompt and skill text is behavior; no meta text.
  expect(drafting).toMatch(/never widen it: not to "no\s+tests were run"/);
  // Environment scope is allowed only with a citation; session runs are history.
  expect(drafting).toMatch(/environment-scope statement[\s\S]{0,200}with that tag/);
  expect(drafting).toMatch(/could not\s+run in\s+this\s+environment/);
  expect(drafting).toMatch(
    /agent-instruction text that changes what users or agents are told/,
  );
  expect(drafting).toMatch(/No meta text in the body/);
  expect(drafting).toMatch(/one motive sentence at most: never a list/);
  expect(drafting).toMatch(/`entry` process row names/);
});

describe('remote paths a recorded live run reached', () => {
  const roles = new Map([
    ['src/net/providers.ts', 'behavior'],
    ['src/commands/draw.ts', 'behavior'],
  ]);
  const remote = {
    change: 'CH1',
    file: 'src/net/providers.ts',
    branches: 4,
    symbols: ['generateImages', 'callGemini'],
    words: ['fetch', 'provider'],
    conds: [
      "+ if (id === 'codex') return codexBatch(jobs);",
      "+ if (id === 'gemini') return callGemini(job);",
      "+ case 'openai':",
    ],
  };
  const hunks = [remote];
  const liveOf = (invocations: LiveEvidence['invocations']): LiveEvidence => ({
    invocations,
    hunks: [
      {
        file: 'src/net/providers.ts',
        scope: null,
        touched: ['generateImages'],
        symbols: ['generateImages'],
        fresh: [],
        code: [],
      },
      {
        file: 'src/commands/draw.ts',
        scope: 'drawArtCmd',
        touched: ['drawArtCmd'],
        symbols: [],
        fresh: [],
        code: ['+ const out = await generateImages(jobs, choice.id);'],
      },
    ],
  });
  const limit = (live?: LiveEvidence) =>
    remotePathRows(hunks, roles, [], live).map((r) => r.limit);

  test('no live run: the open point stands', () => {
    expect(limit(liveOf([]))).toEqual([
      'src/net/providers.ts adds branches that call a remote service (`generateImages`, `callGemini`); no recorded check run shows those paths running against the real service.',
    ]);
    // A formatter given the handler's file runs none of it.
    expect(
      limit(liveOf([{ cmd: 'bun x prettier src/commands/draw.ts', out: [] }])),
    ).toHaveLength(1);
  });

  test("a run of the handler's subcommand naming its route leaves only the other routes open", () => {
    expect(
      limit(liveOf([{ cmd: 'bun src/cli.ts draw art 20261023 codex', out: [] }])),
    ).toEqual([
      'src/net/providers.ts adds branches that call a remote service; the recorded run of `bun src/cli.ts draw art 20261023 codex` used `codex`, and no recorded run shows `gemini`, `openai` running against the real service.',
    ]);
    // The route can come from the run's output.
    expect(
      limit(liveOf([{ cmd: 'mytool draw art', out: ['panel', 'gemini'] }]))[0],
    ).toContain('used `gemini`, and no recorded run shows `codex`, `openai`');
  });

  test('a live run whose route is unknown, or that used every route, drops the row', () => {
    expect(limit(liveOf([{ cmd: 'bun src/cli.ts draw art', out: [] }]))).toEqual([]);
    expect(
      limit(
        liveOf([
          { cmd: 'bun src/cli.ts draw art codex', out: [] },
          { cmd: 'bun src/cli.ts draw art', out: [] },
        ]),
      ),
    ).toEqual([]);
    expect(
      limit(liveOf([{ cmd: 'bun src/cli.ts draw art codex gemini openai', out: [] }])),
    ).toEqual([]);
    // A file with no route values: any live run drops it.
    expect(
      remotePathRows(
        [{ ...remote, conds: [] }],
        roles,
        [],
        liveOf([{ cmd: 'bun src/cli.ts draw art codex', out: [] }]),
      ),
    ).toEqual([]);
  });

  test('invocations: plain words of non-check commands, no flags, assignments or redirections', () => {
    const scrub = { text: (x: string) => x, redactions: 0 } as never;
    const prWords = new Set(['codex', 'panel']);
    expect(
      invocationsOf(
        'cd repo && TOKEN=abc (time bun src/cli.ts draw art --run 20261023 --provider codex) 2>&1 | tail -12; bun test; grep -n x src/a.ts',
        'Panel 1 drawn by Codex in 30s',
        prWords,
        scrub,
      ),
    ).toEqual([
      { cmd: 'bun src/cli.ts draw art 20261023 codex', out: ['panel', 'codex'] },
    ]);
    // Checks, utilities and long key-like tokens are not kept.
    expect(invocationsOf('bun x tsc --noEmit && git status', '', prWords, scrub)).toEqual(
      [],
    );
    expect(
      invocationsOf('mytool login sk0123456789abcdefghijklmn', '', prWords, scrub),
    ).toEqual([{ cmd: 'mytool login', out: [] }]);
  });
});

describe('the entry row says what each function owns', () => {
  const files = [
    fileNode('src/trace/pathMatch.ts'),
    fileNode('src/correlate/correlate.ts'),
  ];
  const hunks = [
    hunkNode('H1', 'src/trace/pathMatch.ts', {
      scope: 'includesPath',
      symbols: ['leadingCd'],
      touched: ['leadingCd'],
      words: ['directory', 'command', 'leading', 'cwd'],
      code: ['+ export function leadingCd(cmd: string, cwd?: string) {'],
      branches: 3,
    }),
    hunkNode('H2', 'src/correlate/correlate.ts', {
      scope: 'belongs',
      touched: ['belongs'],
      words: ['under', 'root', 'mentions', 'match', 'fallback'],
      conds: [
        '+ if (dir) return underAnyRoot(dir, roots) || mentionsAnyRoot(r.cmd, roots);',
      ],
      code: ['+ const dir = leadingCd(r.cmd, r.cwd);'],
      branches: 2,
    }),
  ];
  const rels = [
    ...hunks.map((h) => R('OF', ['Hunk', h.id], ['File', String(h.props.file)])),
    ...hunks.map((h) => R('HAS', ['Change', 'CH1'], ['Hunk', h.id])),
  ];
  const change = N('Change', 'CH1', {
    key: 'commit:abc',
    files: [],
    roles: [],
    symbols: [],
    added: 1,
    removed: 0,
    branches: 0,
  });
  const headRef = N('HeadRef', 'HR1', {
    kind: 'most referenced',
    term: 'leadingCd',
    fresh: true,
    definedIn: ['src/trace/pathMatch.ts'],
    refs: [],
    files: 2,
    count: 3,
  });
  const ctx = {
    sentences: [
      {
        ref: 'abc1234#1',
        text: 'Commands that start with cd are judged by the directory they move to.',
      },
      { ref: 'abc1234#2', text: 'Found while dogfooding.' },
    ],
    links: { 'abc1234#1': ['H1'] },
  };
  const graph = () => graphOf([...files, ...hunks, change, headRef], rels);

  test("the entry's own sentence, and its caller with the branch tied to it", () => {
    const row = withGraph(graph(), (g) => entryRow(g, ctx));
    expect(row?.fact).toBe(
      'Start at `leadingCd` in src/trace/pathMatch.ts; tied to it: Commands that start with cd are judged by the directory they… (abc1234#1). Not in `leadingCd`: `belongs` (src/correlate/correlate.ts): `if (dir) return underAnyRoot(dir, roots)…`.',
    );
    expect(row?.cites).toContain('abc1234#1');
    expect(String(row?.fact).length).toBeLessThanOrEqual(320);
  });

  test('a related function that owns no changed code is not named', () => {
    const owned = graphOf(
      graph().nodes.map((n) =>
        n.id === 'H1'
          ? { ...n, props: { ...n.props, owns: ['leadingCd'] } }
          : n.id === 'H2'
            ? { ...n, props: { ...n.props, owns: [] } }
            : n,
      ),
      graph().rels,
    );
    const row = withGraph(owned, (g) => entryRow(g, ctx));
    expect(row?.fact).toBe(
      'Start at `leadingCd` in src/trace/pathMatch.ts; tied to it: Commands that start with cd are judged by the directory they… (abc1234#1).',
    );
  });

  test('profiles: a sentence goes to the one function its hunk defines, branches to their hunk', () => {
    const p = withGraph(graph(), (g) => functionProfiles(g, ctx));
    expect(p.get('leadingCd')?.sentences.map((x) => x.ref)).toEqual(['abc1234#1']);
    // `includesPath` is only where the hunk starts: nothing is tied to it.
    expect(p.get('includesPath')?.sentences).toEqual([]);
    expect(p.get('belongs')?.conds[0]).toContain('mentionsAnyRoot');
    expect(p.get('belongs')?.words).toContain('fallback');
  });

  test('render flags "start at `fn`, especially <behavior>" tied to another function', () => {
    const owners = withGraph(graph(), (g) => [...functionProfiles(g, ctx).values()]);
    const flag = misplacedFocus(
      'Start review at `leadingCd`, especially the root matching fallback.',
      owners,
    );
    expect(flag?.severity).toBe('check');
    expect(flag?.problem).toContain(
      '`belongs` (src/correlate/correlate.ts), not to `leadingCd`',
    );
    // The behavior tied to the named function, no focus clause, or no pointer: nothing.
    expect(
      misplacedFocus(
        'Start at `leadingCd`, especially the directory a command moves to.',
        owners,
      ),
    ).toBeUndefined();
    expect(
      misplacedFocus('Start at `leadingCd` in pathMatch.ts.', owners),
    ).toBeUndefined();
    expect(
      misplacedFocus(
        '`leadingCd` changed, especially the root matching fallback.',
        owners,
      ),
    ).toBeUndefined();
    // Through applyBrief, as a soft flag.
    const r = applyBrief(
      'Start review at `leadingCd`, especially the root matching fallback. [CH1]\n',
      {
        sections: [],
        unchecked: [],
        owners,
      },
    );
    expect(r.flags.map((f) => f.severity)).toEqual(['check']);
  });
});

describe('stale "no passing run after the last commit"', () => {
  test('matches the limit and its rewordings, not other sentences', () => {
    for (const s of [
      'No passing check run was recorded after the last commit (abc123def456).',
      'There was no successful test run after the last edit.',
      'No check passed after the final commit.',
    ])
      expect(staleNoPass(s)).toBe(true);
    for (const s of [
      'A passing test run came after the last commit.',
      'No user request was recorded for this change.',
      'The suite has no passing run for Windows.',
    ])
      expect(staleNoPass(s)).toBe(false);
  });
  test('flagged only when a receipt passed on the submitted content', () => {
    const body = 'No passing test run was recorded after the last commit.';
    const receipt = {
      sections: [
        {
          title: 'validation',
          columns: ['check'],
          rows: [{ check: 'V1', kind: 'test', outcome: 'passed', cmd: 'bun test' }],
        },
      ],
    } as any;
    // (Unsupported-absence flags are their own check: left out here.)
    const stale = (b: any) =>
      applyBrief(body, b).flags.filter((f) => !/unsupported absence/.test(f.problem));
    expect(stale(receipt).map((f) => f.severity)).toEqual(['fix']);
    const failed = structuredClone(receipt);
    failed.sections[0].rows[0].outcome = 'failed';
    expect(stale(failed)).toEqual([]);
    expect(stale({ sections: [], unchecked: [], freshPass: true })).toHaveLength(1);
  });
});

describe('tested behaviors attributed to the file whose titles show them', () => {
  const tests = [
    {
      ref: 'T1',
      file: 'tests/alpha-fix.test.ts',
      titles: ['keeps quoted arguments intact', 'stops at the earlier-work cutoff'],
    },
    {
      ref: 'T2',
      file: 'tests/render.test.ts',
      titles: ['marks binary changes in the summary', 'draws shared-session panels'],
    },
  ];
  test('a behavior from another file grouped under the named one is flagged', () => {
    const flag = misattributedTests(
      'The alpha-fix tests cover quoted arguments, binary changes and the earlier-work cutoff; the render tests also check shared-session panels.',
      tests,
    );
    expect(flag?.severity).toBe('check');
    expect(flag?.problem).toContain('"binary changes"');
    expect(flag?.problem).toContain('tests/render.test.ts');
    expect(flag?.problem).toContain("not tests/alpha-fix.test.ts's");
    // By path, too.
    expect(
      misattributedTests(
        '`tests/alpha-fix.test.ts` covers binary changes in the summary.',
        tests,
      )?.problem,
    ).toContain('tests/render.test.ts');
  });
  test('correct attributions, weak matches and unnamed files are not flagged', () => {
    for (const s of [
      'The alpha-fix tests cover quoted arguments and the earlier-work cutoff; the render tests check binary changes and shared-session panels.',
      // One shared word is no clear margin.
      'The alpha-fix tests cover binary arguments.',
      // No test file named.
      'Binary changes are marked in the summary.',
      // Named, but no cover/check verb outside the name.
      'See the alpha-fix tests for binary changes.',
    ])
      expect(misattributedTests(s, tests)).toBeUndefined();
  });
  test("applyBrief reports it from the brief's tests rows", () => {
    const b = { sections: [{ title: 'tests', columns: ['ref'], rows: tests }] } as any;
    const r = applyBrief(
      'The alpha-fix tests cover binary changes and the earlier-work cutoff. [T1]',
      b,
    );
    expect(r.flags.map((f) => f.severity)).toEqual(['check']);
  });
});

describe('remote commands and change details', () => {
  test('pushes, PRs made and CI looks are read from a command', async () => {
    const { remoteCommands } = await import('../src/digest/build.ts');
    expect(remoteCommands('git add -A && git commit -m x && git push -u origin feat')).toEqual([
      { cmd: 'git push', kind: 'publish' },
    ]);
    expect(remoteCommands('gh pr create --fill; gh run view 123 --log-failed')).toEqual([
      { cmd: 'gh pr create', kind: 'publish' },
      { cmd: 'gh run view', kind: 'ci' },
    ]);
    expect(remoteCommands('git status && gh pr view 3')).toEqual([]);
    // A PR view whose output shows check results is a look at CI.
    expect(remoteCommands('gh pr view 3 --json statusCheckRollup', '[{"conclusion":"SUCCESS"}]')).toEqual([
      { cmd: 'gh pr view', kind: 'ci' },
    ]);
  });

  test('CI results are read from what a CI look printed', async () => {
    const { ciResults } = await import('../src/digest/build.ts');
    const sha = 'a'.repeat(8) + 'b'.repeat(32);
    expect(ciResults('build\tpass\t1m2s\thttps://x/1\nlint\tfail\t3s\thttps://x/2')).toEqual({ results: true });
    expect(ciResults('Some checks are still pending\n0 cancelled, 1 failing, 5 successful, 0 skipped, and 2 pending checks')).toEqual({ results: true });
    expect(ciResults(`[{"conclusion":"success","headSha":"${sha}","name":"CI"}]`)).toEqual({
      results: true,
      heads: [sha.slice(0, 12)],
    });
    // Only pending, or an error: no results.
    expect(ciResults('0 failing, 0 successful, 3 pending checks')).toEqual({});
    expect(ciResults('unknown flag: --json')).toEqual({});
    expect(ciResults(undefined)).toEqual({});
  });

  test('details: flags, thresholds, defaults, workflow steps, config keys', async () => {
    const { detailsOf, clipClause } = await import('../src/graph/queries.ts');
    const roles: Record<string, string> = {
      'src/cli.ts': 'behavior',
      '.github/workflows/ci.yml': 'config',
      'config/app.json': 'config',
      'docs/a.md': 'docs',
    };
    const d = detailsOf(
      [
        {
          file: 'src/cli.ts',
          code: [
            "+ .option('--no-timeout', 'wait for the reader')",
            '+ const MIN_DURATION_MS = 750;',
            '+ if (elapsed < 1500) return;',
            "+ const mode = opts.mode ?? 'fast';",
            '+ for (let i = 0; i < n; i++) {}',
          ],
        },
        { file: '.github/workflows/ci.yml', code: ['+ publish:', '+ - name: Upload SBOM'] },
        { file: 'docs/a.md', code: ['+ Use --verbose for more.'] },
      ],
      (f) => roles[f] ?? 'behavior',
    );
    expect(d).toEqual(['--no-timeout', 'MIN_DURATION_MS = 750', 'job publish', 'step "Upload SBOM"']);
    const long = `Readers answer at their own pace, so the final interactive command runs with no watchdog timeout, while compile and build commands keep the existing execution timeout policy for every run of a sample input and every other path that does not wait on a reader at all`;
    const c = clipClause(long, 200);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(c.endsWith('…')).toBe(true);
    expect(c).toContain('no watchdog timeout');
  });
});

describe('details: only clean facts', () => {
  test('fallback chains, ternaries, mismatched flag/value pairs, locals and test values are left out', async () => {
    const { detailsOf } = await import('../src/graph/queries.ts');
    const d = detailsOf(
      [
        {
          file: 'src/run.ts',
          code: [
            "+ const out = flag('--out') ?? 'medium';",
            "+ const effort = args.effort ?? opts.mode ?? 'acceptEdits';",
            "+ const tools = argv.includes('--tools') || argv.includes('--allowedTools') ? list : 45;",
            '+ const desired = 2;',
            '+ let height = 4;',
            '+ const exitCode = 127;',
            "+ const label = title ?? 'Running verification';",
            '+ const diff = 120;',
            '+ const limit = 40;',
            '+ for (let i = 0, step = 3; i < n; i++) {}',
          ],
        },
        {
          file: 'src/lib/thing.test.ts',
          code: ['+ const MAX_ITEMS = 9;', "+ .option('--fake <x>', 'desc', 'y')"],
        },
        {
          file: 'tests/fixtures/run.ts',
          code: ['+ const RETRY_LIMIT = 7;'],
        },
      ],
      () => 'behavior',
    );
    // Flags stay, never paired with a fallback value from another expression.
    expect(d).toEqual(['--out', '--tools', '--allowedTools']);
  });

  test('flag defaults, named constants and settings with one literal are kept', async () => {
    const { detailsOf } = await import('../src/graph/queries.ts');
    const d = detailsOf(
      [
        {
          file: 'src/cli.ts',
          code: [
            "+ .option('--effort <level>', 'reasoning effort', 'medium')",
            "+ { flag: '--jobs', default: 4 },",
            '+ export const HISTORY_GENERATION = 2;',
            '+ const retryTimeoutMs = 30_000;',
            '+   maxRetries: 3,',
          ],
        },
      ],
      () => 'behavior',
    );
    expect(d).toEqual([
      "--effort (default 'medium')",
      '--jobs (default 4)',
      'HISTORY_GENERATION = 2',
      'retryTimeoutMs = 30_000',
      'maxRetries = 3',
    ]);
  });
});

describe('details: config noise', () => {
  test('versions, build ids, prose values and one-character fallbacks are left out', async () => {
    const { detailsOf } = await import('../src/graph/queries.ts');
    const d = detailsOf(
      [
        {
          file: 'config/app.json',
          code: [
            '+ "version": "1.2.3",',
            '+ "buildId": "3a604c88a7c5b63cd9489d6bf6646ac7",',
            '+ "description": "Render a screenshot of the first frame",',
            '+ "interval": "monthly",',
          ],
        },
        { file: 'src/a.ts', code: ["+ const dir = opts.dir ?? '.';"] },
      ],
      (f) => (f.endsWith('.json') ? 'config' : 'behavior'),
    );
    expect(d).toEqual(['interval: "monthly"']);
  });
});

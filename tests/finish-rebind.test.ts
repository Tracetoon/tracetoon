import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findingsAgentId, parseFindings } from '../src/contribution/leanReview.ts';
import { newWordShare, withoutComic } from '../src/workflow/rebind.ts';
import { pageScript } from './pageScript.ts';
import { BLOCKING_RULE } from '../src/commands/finish.ts';
import { graphNext } from '../src/commands/digest.ts';
import { lifecycle } from '../src/hook/lifecycle.ts';
import { repository, tasks } from '../src/workflow/state.ts';
import { readLocal, writeLocal } from '../src/util/localJson.ts';
import { git } from '../src/util/exec.ts';
import { findRun } from '../src/run.ts';
import { makeRepo, tempDir } from './helpers.ts';

setDefaultTimeout(180_000);

const CLI = resolve(import.meta.dir, '../src/cli.ts');
// A 1x1 PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
let previous: string | undefined;
let config: string;
beforeEach(() => {
  previous = process.env.TRACETOON_CONFIG;
  config = join(tempDir('tracetoon-finish-'), 'config.json');
  process.env.TRACETOON_CONFIG = config;
});
afterEach(() => {
  if (previous === undefined) delete process.env.TRACETOON_CONFIG;
  else process.env.TRACETOON_CONFIG = previous;
});
const env = () => ({ ...process.env, CI: '', TRACETOON: '1' });
function cli(root: string, args: string[], json = true) {
  const result = spawnSync(process.execPath, [CLI, ...(json ? ['--json'] : []), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...env(),
      CLAUDE_CONFIG_DIR: join(dirname(config), 'claude'),
      CODEX_HOME: join(dirname(config), 'codex'),
      GEMINI_HOME: join(dirname(config), 'gemini'),
      TRACETOON_GH_SCRIPT: resolve(import.meta.dir, 'fake-gh.ts'),
      FAKE_GH_STATE: join(dirname(config), 'gh-state.json'),
      CODEX_THREAD_ID: '',
      CLAUDE_CODE_SESSION_ID: '',
      CLAUDE_SESSION_ID: '',
    },
  });
  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = { error: result.stderr || result.stdout };
  }
  return { code: result.status, json: parsed, stdout: result.stdout, stderr: result.stderr };
}
function ok(root: string, ...args: string[]) {
  const r = cli(root, args);
  expect(r.json.error).toBeUndefined();
  expect(r.code).toBe(0);
  return r.json;
}

/** A task run with a body, a change map and a review plan, rendered once. */
function preparedRun(recheck: 'none' | 'once') {
  const repo = makeRepo();
  const remote = tempDir('tracetoon-finish-remote-');
  expect(git(remote, ['init', '-q', '--bare']).ok).toBe(true);
  expect(git(repo.root, ['remote', 'add', 'origin', remote]).ok).toBe(true);
  const p = { cwd: repo.root, session_id: 'finish' };
  lifecycle('codex', 'SessionStart', p, env());
  repo.commit(
    'src/greet.ts',
    "export function greet(name?: string) {\n  if (!name) return 'hello';\n  return `hello ${name}`;\n}\n",
    'Greet by name',
  );
  lifecycle(
    'codex',
    'PreToolUse',
    { ...p, tool_input: { command: 'gh pr create --fill' } },
    env(),
  );
  const run = findRun(
    repository(repo.root).gitDir,
    tasks(repository(repo.root).gitDir)[0]!.run.id,
  );
  ok(repo.root, 'digest', '--run', run.id, '--offline');
  ok(repo.root, 'context', '--run', run.id, '--offline');
  writeFileSync(
    join(run.dir, 'body.md'),
    'The greeting always uses the given name.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n',
  );
  writeFileSync(join(run.dir, 'title.txt'), 'Greet by name');
  ok(repo.root, 'render', '--run', run.id, '--no-comic');
  const patch = readFileSync(join(run.dir, 'changes.patch'), 'utf8').split('\n');
  const ifLine = patch.findIndex((l) => l.includes('if (!name)')) + 1;
  writeLocal(join(run.dir, 'change-map.json'), {
    groups: [
      {
        idea: 'Greeting',
        behavior: 'Greets by name, else hello.',
        kind: 'behavior',
        paths: ['src/greet.ts'],
        behaviorChecks: [{ behavior: 'No name: hello', evidence: [`diff:${ifLine}`] }],
      },
    ],
  });
  writeLocal(join(run.dir, 'review-plan.json'), {
    v: 1,
    passes: 1,
    lenses: [],
    reviewerModel: 'sonnet',
    recheck,
  });
  // The reviewer didn't know its id: the file says null, the host's id comes by flag.
  writeLocal(join(run.dir, 'review-findings.json'), {
    v: 1,
    reviewer: { agentId: null },
    findings: [
      {
        kind: 'claim',
        quote: 'always uses the given name',
        verdict: 'overstated',
        evidence: `diff:${ifLine}`,
        fix: 'Say it falls back to hello.',
      },
    ],
  });
  return { repo, run };
}

describe('review import agent id', () => {
  test('--agent-id stands in for a null or empty reviewer id; aliases are read', () => {
    const file = { v: 1, reviewer: { agentId: null }, findings: [] };
    expect(() => parseFindings(structuredClone(file))).toThrow('"reviewer" must be');
    expect(
      parseFindings(structuredClone(file), { agentId: 'a1b2c3' }).findings.reviewer.agentId,
    ).toBe('a1b2c3');
    expect(
      parseFindings({ v: 1, findings: [] }, { agentId: 'a1b2c3' }).findings.reviewer
        .agentId,
    ).toBe('a1b2c3');
    expect(findingsAgentId({ reviewer: { agent_id: 'x9y8' } })).toBe('x9y8');
    expect(findingsAgentId({ agentId: 'z7', reviewer: { agentId: '' } })).toBe('z7');
    expect(findingsAgentId({ reviewer: { agentId: 'unknown' } })).toBeUndefined();
    expect(parseFindings({ v: 1, reviewer: { id: 'q1w2' }, findings: [] }).findings.reviewer.agentId).toBe('q1w2');
  });
});

describe('finish and publish rebind', () => {
  test('finish walks render → packet → merged list → bind; publish needs no manual rebind', () => {
    const { repo, run } = preparedRun('none');
    // Before any review: finish renders and writes the packet.
    const first = ok(repo.root, 'finish', '--run', run.id);
    expect(first.packets).toEqual([join(run.dir, 'review-packet.md')]);
    expect(existsSync(join(run.dir, 'review-packet.md'))).toBe(true);
    expect(first.next).toContain('--agent-id <its id> --reviewer-model sonnet');
    ok(
      repo.root,
      'review',
      'import',
      '--run',
      run.id,
      '--agent-id',
      'a7c3e19f2b',
      '--reviewer-model',
      'sonnet',
    );
    // Same body as reviewed: the merged list to apply.
    const second = ok(repo.root, 'finish', '--run', run.id);
    expect(second.merged).toBe(1);
    expect(second.next).toContain('ONE edit pass');
    // The correction round, then a plain render (no rebind): review is stale.
    writeFileSync(
      join(run.dir, 'body.md'),
      "The greeting uses the given name, or says hello when there is none.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n",
    );
    const rendered = ok(repo.root, 'render', '--run', run.id, '--no-comic');
    expect(rendered.contributionReview.status).toBe('stale');
    // Text-mode finish: compact, binds the review itself, next is publish.
    const text = cli(repo.root, ['finish', '--run', run.id], false);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('bound the review to this render');
    expect(text.stdout).toContain(`Next: tracetoon publish --run ${run.id}`);
    expect(text.stdout.split('\n').length).toBeLessThan(12);
    // Stale again after another plain render; publish binds and renders itself.
    writeFileSync(
      join(run.dir, 'body.md'),
      "The greeting uses the given name, or says hello when no name is given.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n",
    );
    ok(repo.root, 'render', '--run', run.id, '--no-comic');
    const published = cli(repo.root, ['publish', '--run', run.id], false);
    expect(published.stderr).toBe('');
    expect(published.code).toBe(0);
    expect(published.stdout).toContain('Bound the review to the final render');
    expect(published.stdout).toContain('pull/7');
    const review = readLocal<any>(join(run.dir, 'review.json'))!;
    expect(review.inputFingerprint).toBe(
      readLocal<any>(join(run.dir, 'review-input.json'))!.fingerprint,
    );
  });

  test('a fix committed after a review: fresh passes on the new code supersede the old ones (#219)', () => {
    const { repo, run } = preparedRun('none');
    ok(repo.root, 'finish', '--run', run.id);
    const importPass = (agent: string) =>
      ok(
        repo.root,
        'review',
        'import',
        '--run',
        run.id,
        '--agent-id',
        agent,
        '--reviewer-model',
        'sonnet',
      );
    importPass('a7c3e19f2b');
    // A code fix after the review, then a fresh digest and render.
    repo.commit(
      'src/greet.ts',
      "export function greet(name?: string) {\n  if (!name?.trim()) return 'hello';\n  return `hello ${name}`;\n}\n",
      'Treat a blank name as no name',
    );
    ok(repo.root, 'digest', '--run', run.id, '--offline');
    ok(repo.root, 'context', '--run', run.id, '--offline');
    writeFileSync(
      join(run.dir, 'body.md'),
      'The greeting uses the given name, or says hello when it is missing or blank.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n',
    );
    ok(repo.root, 'render', '--run', run.id, '--no-comic');
    // Only the old pass: publish still refuses, naming it.
    const before = cli(repo.root, ['finish', '--run', run.id], false);
    expect(before.stdout + before.stderr).toContain(
      'reviewer pass 1 reviewed different code',
    );
    // A fresh pass on the new code meets the plan on its own: the old one is superseded.
    writeLocal(join(run.dir, 'review-findings.json'), {
      v: 1,
      reviewer: { agentId: null },
      findings: [],
    });
    importPass('b8d4f20a3c');
    // The correction round after the fresh review: finish binds the review itself.
    writeFileSync(
      join(run.dir, 'body.md'),
      'The greeting uses the given name, or says hello when the name is missing or blank.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n',
    );
    ok(repo.root, 'render', '--run', run.id, '--no-comic');
    const text = cli(repo.root, ['finish', '--run', run.id], false);
    expect(text.stdout + text.stderr).not.toContain('reviewed different code');
    expect(text.stdout).toContain(`Next: tracetoon publish --run ${run.id}`);
    const passes = readLocal<any>(join(run.dir, 'review-passes.json'))!.passes;
    expect(passes.map((p: any) => p.agentId)).toEqual(['b8d4f20a3c']);
    const superseded = readLocal<any>(
      join(run.dir, 'review-passes-superseded.json'),
    )!.passes;
    expect(superseded.map((p: any) => p.agentId)).toEqual(['a7c3e19f2b']);
    const published = cli(repo.root, ['publish', '--run', run.id], false);
    expect(published.code).toBe(0);
    expect(published.stdout).toContain('pull/7');
  });

  test('a comic added after the review never invalidates the review of the prose', () => {
    const { repo, run } = preparedRun('none');
    ok(repo.root, 'finish', '--run', run.id);
    ok(
      repo.root,
      'review',
      'import',
      '--run',
      run.id,
      '--agent-id',
      'a7c3e19f2b',
      '--reviewer-model',
      'sonnet',
    );
    // The correction round, while comic run draws the comic beside the reviews.
    writeFileSync(
      join(run.dir, 'body.md'),
      "The greeting uses the given name, or says hello when there is none.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n",
    );
    writeFileSync(join(run.dir, 'comic.json'), JSON.stringify(pageScript()));
    mkdirSync(join(run.dir, 'out'), { recursive: true });
    writeFileSync(join(run.dir, 'out', 'comic.png'), PIXEL);
    // The comic's image and transcript are far more words than this short body.
    const text = cli(repo.root, ['finish', '--run', run.id], false);
    expect(text.stdout + text.stderr).not.toContain('of the description is new');
    expect(text.stdout).toContain('bound the review to this render');
    expect(readFileSync(join(run.dir, 'final-body.md'), 'utf8')).toContain('Comic transcript');
    // Prose that really grew past the review still refuses.
    expect(
      newWordShare(
        'a b c d',
        withoutComic(`a b c d\n\n<p align="center"><img src="{{tracetoon:comic-src}}" alt="x y z" width="760"></p>\n\n<details>\n<summary>Comic transcript</summary>\n\n1. q r s t\n\n</details>`),
      ),
    ).toBe(0);
  });

  test('with Review recheck: once, or unrendered edits, publish still refuses and says why', () => {
    const { repo, run } = preparedRun('once');
    ok(repo.root, 'render', '--run', run.id, '--no-comic');
    ok(
      repo.root,
      'review',
      'import',
      '--run',
      run.id,
      '--agent-id',
      'a7c3e19f2b',
      '--reviewer-model',
      'sonnet',
    );
    writeFileSync(
      join(run.dir, 'body.md'),
      'The greeting uses the given name, or says hello.\n\nIt previously only said hello.\n\nSee src/greet.ts.\n',
    );
    ok(repo.root, 'render', '--run', run.id, '--no-comic');
    const refused = cli(repo.root, ['publish', '--run', run.id]);
    expect(refused.code).not.toBe(0);
    expect(refused.json.error).toContain("can't rebind it itself");
    expect(refused.json.error).toContain('asks for a recheck');
  });

  test('new-word share counts words the reviewed body lacks', () => {
    expect(newWordShare('a b c d', 'a b c d')).toBe(0);
    expect(newWordShare('a b c d', 'a b x y')).toBe(0.5);
    expect(newWordShare('a b', 'a b c d e f')).toBe(2);
  });
});

describe('blocking guidance', () => {
  test("prepare's next step tells Codex one long wait, not short polls, and uses finish", () => {
    expect(BLOCKING_RULE).toContain('yield_time_ms: 300000');
    expect(BLOCKING_RULE).toContain('never poll with short waits');
    const next = graphNext('r1', {
      v: 1,
      passes: 2,
      lenses: ['d'],
      reviewerModel: 'luna',
      runner: 'tracetoon',
      recheck: 'none',
    });
    expect(next).toContain('tracetoon finish --run r1');
    expect(next).toContain('yield_time_ms: 300000');
  });
});

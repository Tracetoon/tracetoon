import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { graphNext } from '../src/commands/digest.ts';
import type { ComicExpectation } from '../src/comic/expectation.ts';
import type { ReviewPlan } from '../src/contribution/reviewPlan.ts';
import { ClaudeLog, makeRepo, tempDir } from './helpers.ts';

setDefaultTimeout(180_000);
const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
const FAKE_CODEX = resolve(import.meta.dir, 'fake-codex.ts');
const FAKE_CLAUDE = resolve(import.meta.dir, 'fake-claude-review.ts');
const GREET =
  'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n';

describe('tracetoon comic run', () => {
  let env: NodeJS.ProcessEnv;
  let log: string;
  beforeEach(() => {
    const scratch = tempDir('tracetoon-env-');
    log = join(scratch, 'agents.log');
    env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: tempDir('tracetoon-claude-'),
      CODEX_HOME: tempDir('tracetoon-codex-'),
      ANTIGRAVITY_HOME: tempDir('tracetoon-gemini-'),
      GEMINI_HOME: tempDir('tracetoon-gemini-'),
      TRACETOON_CONFIG: join(scratch, 'config.json'),
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      TRACETOON_AGY_BIN: 'none',
      // The image route: the fake Codex CLI draws.
      TRACETOON_CODEX_BIN: FAKE_CODEX,
      TRACETOON_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CODEX_LOG: log,
    };
  });
  const cli = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
    let json: any;
    try {
      json = JSON.parse(r.stdout);
    } catch {
      /* text */
    }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
  };
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as { args: string[]; prompt: string; images?: string[] })
      : [];

  function prepared() {
    const repo = makeRepo();
    new ClaudeLog(repo.root)
      .prompt('Add greeting')
      .write(join(repo.root, 'src/greet.ts'), GREET)
      .save(env.CLAUDE_CONFIG_DIR!, 's1');
    repo.commit('src/greet.ts', GREET, 'feat: greeting helper');
    expect(cli(repo.root, '--json', 'digest', '--offline').code).toBe(0);
    const c = cli(repo.root, '--json', 'context', '--offline');
    expect(c.json.comic.expectation.expected).toBe(true);
    const runDir = c.json.runDir as string;
    writeFileSync(join(runDir, 'body.md'), '## Summary\nAdds a greeting helper.\n');
    writeFileSync(join(runDir, 'title.txt'), 'Add greeting helper\n');
    return { repo, runDir, run: c.json.run as string };
  }
  const approveCodex = () =>
    writeFileSync(env.TRACETOON_CONFIG!, JSON.stringify({ imageConsent: 'codex' }));

  for (const runner of ['claude', 'codex'] as const) {
    test(`${runner}: author, art, render and the full loop with judges Tracetoon starts and verifies`, () => {
      approveCodex();
      env.TRACETOON_REVIEW_RUNNER = runner;
      env.FAKE_COMIC_AUTHOR_FIRST = 'bad';
      const { repo, runDir } = prepared();
      const r = cli(repo.root, '--json', 'comic', 'run');
      // State and reason together, so a failure says why the comic was skipped.
      expect({ code: r.code, state: r.json?.state, reason: r.json?.reason ?? r.json?.error ?? r.stderr }).toMatchObject({
        code: 0,
        state: 'drawn',
      });
      expect(r.json.selected).toBe('c1');
      expect(r.json.comicSetup).toBeUndefined();
      expect(existsSync(join(runDir, 'out', 'comic.png'))).toBe(true);
      expect(existsSync(join(runDir, 'comic-design.json'))).toBe(true);
      const runnerId = runner === 'claude' ? 'claude-print' : 'codex-exec';
      const model = runner === 'claude' ? 'claude-haiku-5-5' : 'gpt-6.1';
      // The author's first script failed comic check; the same session fixed it. Then the loop asked
      // for an independent second draft: a fresh author session, never a resumed one.
      const authors = r.json.agents.filter((a: any) => a.role === 'author');
      // Each draft's first script fails here (FAKE_COMIC_AUTHOR_FIRST=bad), so each takes one correction.
      expect(authors.length).toBe(4);
      const correction = calls().find((c) => c.prompt.includes('found these problems'))!;
      expect(correction.args).toContain(runner === 'claude' ? '--resume' : 'resume');
      expect(correction.args).toContain(authors[0].sessionId);
      expect(authors[2].sessionId).not.toBe(authors[0].sessionId);
      expect(authors[2].sessionId).not.toBe(authors[1].sessionId);
      const authorCalls = calls().filter((c) => !c.prompt.includes('found these problems') && c.prompt.includes('(The packet files sit in'));
      expect(authorCalls.length).toBe(2);
      for (const c of authorCalls) expect(c.args).not.toContain(runner === 'claude' ? '--resume' : 'resume');
      // Each judge was imported with its real session id and verified model.
      const loop = JSON.parse(readFileSync(join(runDir, 'comic-loop.json'), 'utf8'));
      const tasks = Object.keys(loop.provenance);
      // No phone stage: comics are drawn for a desktop PR; every image gets the misread review first.
      expect(tasks).toEqual(expect.arrayContaining(['misread:c1', 'observe:c1', 'check:c1']));
      for (const t of tasks) {
        expect(loop.provenance[t]).toMatchObject({
          source: 'tracetoon-run',
          runner: runnerId,
          verifiedModel: model,
        });
        expect(loop.agents[t]).toBe(loop.provenance[t].sessionId);
      }
      expect(loop.incumbent).toBe('c1');
      // The cold reader saw only its packet: no script, no PR text.
      const observe = calls().find((c) => c.prompt.includes(join('judge', 'observe-c1')))!;
      expect(observe.prompt).not.toContain('Where is this file?');
      expect(observe.prompt).not.toContain('Adds a greeting helper');
      if (runner === 'codex') {
        expect(observe.images?.[0]).toContain(join('judge', 'observe-c1'));
        expect(observe.args).toContain('read-only');
      } else {
        expect(observe.args).toContain('--tools');
        expect(observe.args[observe.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
      }
    });
  }

  test('image setup pending: records the skip and prints a COMIC SETUP line, asking no one', () => {
    env.TRACETOON_REVIEW_RUNNER = 'claude';
    const { repo, runDir } = prepared();
    const r = cli(repo.root, 'comic', 'run');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No comic on this PR, recorded: image setup awaits the user's answer.");
    expect(r.stdout).toMatch(/^COMIC SETUP: Ask the user to approve Codex/m);
    const status = JSON.parse(readFileSync(join(runDir, 'comic-status.json'), 'utf8'));
    expect(status).toMatchObject({ state: 'skipped', by: 'agent' });
    // No author or judge was started.
    expect(calls().filter((c) => c.prompt.includes('tracetoon comic run'))).toEqual([]);
  });

  test('comic off: nothing to do', () => {
    writeFileSync(env.TRACETOON_CONFIG!, JSON.stringify({ comic: 'off' }));
    const { repo } = prepared_off();
    const r = cli(repo.root, '--json', 'comic', 'run');
    expect(r.code).toBe(0);
    expect(r.json.state).toBe('not-expected');
  });

  function prepared_off() {
    const repo = makeRepo();
    repo.commit('src/greet.ts', GREET, 'feat: greeting helper');
    expect(cli(repo.root, '--json', 'digest', '--offline').code).toBe(0);
    expect(cli(repo.root, '--json', 'context', '--offline').code).toBe(0);
    return { repo };
  }
});

describe('the delegated drafter runs the comic and the reviewers in parallel', () => {
  const plan: ReviewPlan = {
    v: 1,
    passes: 2,
    lenses: ['d'],
    reviewerModel: 'haiku',
    reviewerEffort: 'xhigh',
    runner: 'tracetoon',
    recheck: 'none',
  };
  const ready: ComicExpectation = {
    expected: true,
    why: 'comics are on by default (comic: allowed)',
    route: { kind: 'ready', route: 'codex', text: 'Comics are ready: Codex.' },
    askSetup: false,
  };
  test('Claude Code: two foreground Bash calls in one message', () => {
    const next = graphNext('r1', plan, ready, { role: 'drafter', host: 'claude' });
    expect(next).toContain(
      'start BOTH `tracetoon review run --all --run r1`',
    );
    expect(next).toContain('and `tracetoon comic run --run r1`');
    expect(next).toContain('two foreground Bash calls in ONE message, each with `timeout: 600000`');
    expect(next).toContain('When both have exited, apply it in ONE edit pass');
    expect(next.indexOf('tracetoon comic run')).toBeLessThan(next.indexOf('tracetoon publish --run r1'));
  });
  test('Codex: one exec with both exec_command calls in Promise.all', () => {
    const next = graphNext('r1', plan, ready, { role: 'drafter', host: 'codex' });
    expect(next).toContain('start BOTH `tracetoon review run --all --run r1`');
    expect(next).toContain('`exec_command` inside `Promise.all`');
    expect(next).toContain('"yield_time_ms": 900000');
  });
  test('agent reviewers: the comic runs on its own before publish', () => {
    const next = graphNext('r1', { ...plan, runner: undefined }, ready, {
      role: 'drafter',
      host: 'claude',
    });
    expect(next).not.toContain('start BOTH');
    expect(next).toContain('run `tracetoon comic run --run r1`');
  });
  test('the self-drafting path keeps the comic subagent flow', () => {
    const next = graphNext('r1', plan, ready);
    expect(next).not.toContain('tracetoon comic run');
    expect(next).toContain('draw the comic (references/full-path.md step 5)');
  });
});

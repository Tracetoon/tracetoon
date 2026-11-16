import { expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leanPacket } from '../src/commands/review.ts';
import { patchHunks } from '../src/graph/build.ts';
import { ClaudeLog, makeRepo, tempDir } from './helpers.ts';

const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
const PROGRAM = process.env.TRACETOON_TEST_BINARY
  ? [process.env.TRACETOON_TEST_BINARY]
  : [process.execPath, CLI];
setDefaultTimeout(60_000);

// A few bytes git treats as binary: a PNG signature and a NUL.
const PNG = (n: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    Buffer.alloc(32, n),
  ]);

function cli(cwd: string, claudeHome: string, ...args: string[]) {
  const scratch = tempDir('tracetoon-env-');
  const r = spawnSync(PROGRAM[0]!, [...PROGRAM.slice(1), ...args], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: tempDir('tracetoon-codex-'),
      ANTIGRAVITY_HOME: tempDir('tracetoon-gemini-'),
      GEMINI_HOME: tempDir('tracetoon-gemini-'),
      TRACETOON_CONFIG: join(scratch, 'config.json'),
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: tryJson(r.stdout) };
}
const tryJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

test('patch hunks: a binary file becomes a hunk with its diff line and kind', () => {
  const patch = [
    'diff --git a/img/logo.png b/img/logo.png',
    'index 1111111..2222222 100644',
    'Binary files a/img/logo.png and b/img/logo.png differ',
    'diff --git a/img/new.webp b/img/new.webp',
    'new file mode 100644',
    'index 0000000..3333333',
    'Binary files /dev/null and b/img/new.webp differ',
    'diff --git a/img/old.gif b/img/old.gif',
    'deleted file mode 100644',
    'index 4444444..0000000',
    'Binary files a/img/old.gif and /dev/null differ',
  ].join('\n');
  const hunks = patchHunks(patch);
  expect(hunks.map((h) => [h.id, h.file, h.binary, h.diff])).toEqual([
    ['H1', 'img/logo.png', 'modified', 'diff:3'],
    ['H2', 'img/new.webp', 'added', 'diff:7'],
    ['H3', 'img/old.gif', 'deleted', 'diff:11'],
  ]);
  expect(hunks.every((h) => h.added === 0 && h.removed === 0)).toBe(true);
});

test('a binary-only PR keeps its change, its commit message and the request behind it', () => {
  const claudeHome = tempDir('tracetoon-claude-');
  const repo = makeRepo();
  // The base already has the old logo; the branch replaces it.
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: repo.root });
  mkdirSync(join(repo.root, 'img'), { recursive: true });
  writeFileSync(join(repo.root, 'img/logo.png'), PNG(1));
  spawnSync('git', ['add', '.'], { cwd: repo.root });
  spawnSync('git', ['commit', '-q', '-m', 'add the old logo'], { cwd: repo.root });
  spawnSync('git', ['checkout', '-q', 'feature'], { cwd: repo.root });
  spawnSync('git', ['merge', '-q', 'main'], { cwd: repo.root });
  const subject = 'Swap the logo for the one with the new domain';
  const sha = repo.commit(
    'img/logo.png',
    PNG(2) as unknown as string,
    `${subject}\n\nThe old logo still printed the old domain in its corner.`,
  );
  new ClaudeLog(repo.root)
    .prompt('The logo still shows the old domain; replace it with the new one')
    .bash(
      `git commit -am "${subject}"`,
      `[feature ${sha.slice(0, 7)}] ${subject}\n 1 file changed`,
    )
    .save(claudeHome, 'binary');

  const prep = cli(
    repo.root,
    claudeHome,
    '--json',
    'prepare',
    '--offline',
    '--base',
    'main',
  );
  expect(prep.code).toBe(0);
  const brief = cli(
    repo.root,
    claudeHome,
    '--json',
    'query',
    'brief',
    '--run',
    prep.json.run,
  );
  expect(brief.code).toBe(0);
  const rows = (title: string) =>
    brief.json.sections.find((s: any) => s.title === title)?.rows ?? [];

  const [change] = rows('changes');
  expect(change).toBeDefined();
  expect(String(change.where)).toContain('img/logo.png (binary, modified)');
  expect(String(change.behavior)).toContain('logo.png: binary file modified');
  expect(change.diff).toEqual([expect.stringMatching(/^diff:\d+$/)]);
  expect(change.commits).toEqual([sha.slice(0, 12)]);

  const commits = rows('commitMessages').map((r: any) => r.ref);
  expect(commits).toContain(sha.slice(0, 12));
  expect(commits).toContain(`${sha.slice(0, 12)}#1`);

  const requests = rows('requests');
  expect(requests.map((r: any) => r.text)).toContain(
    'The logo still shows the old domain; replace it with the new one',
  );
});

test('the lean review packet shows a binary-only change instead of "No hunks to show"', () => {
  const patch = [
    'diff --git a/docs/img/comic.webp b/docs/img/comic.webp',
    'index 1111111..2222222 100644',
    'Binary files a/docs/img/comic.webp and b/docs/img/comic.webp differ',
  ].join('\n');
  const text = leanPacket({
    runId: 'r1',
    title: 'Redraw the comic',
    body: 'Replaces the comic with a redraw.',
    patch,
    fingerprint: 'abc',
  }).text;
  expect(text).toContain(
    '- H1 docs/img/comic.webp diff:3 | binary file modified: no lines to read; compare the files',
  );
  expect(text).toContain(
    '3 Binary files a/docs/img/comic.webp and b/docs/img/comic.webp differ',
  );
  expect(text).not.toContain('(No hunks to show.)');
});

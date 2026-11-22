import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGenreCatalog, parseGenreFile, repoGenresDir } from '../src/comic/genreFile.ts';
import { genreOptions, GENRES } from '../src/comic/genres.ts';
import { artPrompt, pagePrompt } from '../src/comic/providers.ts';
import { checkScript } from '../src/comic/script.ts';
import { anchoredStory } from './fixtures/comic-stories.ts';
import { makeRepo, tempDir } from './helpers.ts';

setDefaultTimeout(90_000);
const CLI = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');

const PIRATES = `---
id: build-pirates
name: Build pirates
setting: a leaky galleon in a storm of failing builds
archetypes:
  - one-eyed captain
  - parrot that repeats log lines
props:
  - treasure map
  - "flag on the mast"
jokeHooks:
  - the treasure is a green check
styles:
  - webcomic
---
Keep the sea shanties short.
`;

/** A scratch user config dir; genre files go in its genres/ folder. */
function userConfig(files: Record<string, string>): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = tempDir('tracetoon-genres-');
  mkdirSync(join(dir, 'genres'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'genres', name), text);
  return { env: { ...process.env, TRACETOON_CONFIG: join(dir, 'config.json') }, dir };
}

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const old = process.env.TRACETOON_CONFIG;
  process.env.TRACETOON_CONFIG = env.TRACETOON_CONFIG;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.TRACETOON_CONFIG;
    else process.env.TRACETOON_CONFIG = old;
  }
}

describe('genre files', () => {
  test('a valid file becomes a genre with its notes', () => {
    const { genre, problems } = parseGenreFile(PIRATES, { source: 'user' });
    expect(problems).toEqual([]);
    expect(genre).toMatchObject({
      id: 'build-pirates',
      name: 'Build pirates',
      archetypes: ['one-eyed captain', 'parrot that repeats log lines'],
      props: ['treasure map', 'flag on the mast'],
      styles: ['webcomic'],
      notes: 'Keep the sea shanties short.',
      source: 'user',
    });
  });

  test('missing fields, bad ids, unknown fields and unknown styles are errors', () => {
    const { genre, problems } = parseGenreFile(
      '---\nid: Bad Id\nname: x\ncolour: red\nstyles:\n  - not-a-style\n---\n',
    );
    expect(genre).toBeUndefined();
    const where = problems.map((p) => p.where);
    expect(where).toEqual(
      expect.arrayContaining(['id', 'setting', 'archetypes', 'props', 'colour', 'styles[0]']),
    );
  });

  test('a file without frontmatter is rejected, not guessed at', () => {
    const { genre, problems } = parseGenreFile('# Pirates\n\nArr.');
    expect(genre).toBeUndefined();
    expect(problems[0]!.where).toBe('file');
  });

  test('franchise names are warnings, so the genre still loads', () => {
    const { genre, problems } = parseGenreFile(
      PIRATES.replace('one-eyed captain', 'a captain like Picard'),
    );
    expect(genre).toBeDefined();
    expect(problems.some((p) => p.severity === 'warning' && p.where === 'archetypes[0]')).toBe(true);
  });

  test('the catalog adds user genres and lets the repo override them by id', () => {
    const { env } = userConfig({ 'pirates.md': PIRATES, 'broken.md': '---\nid: x\n---\n' });
    const { root } = makeRepo();
    mkdirSync(repoGenresDir(root), { recursive: true });
    writeFileSync(
      join(repoGenresDir(root), 'pirates.md'),
      PIRATES.replace('name: Build pirates', 'name: Repo pirates'),
    );
    const { genres, files } = withEnv(env, () => loadGenreCatalog(root));
    expect(genres.length).toBe(GENRES.length + 1);
    const pirates = genres.find((g) => g.id === 'build-pirates')!;
    expect(pirates).toMatchObject({ name: 'Repo pirates', source: 'repo' });
    expect(genres.find((g) => g.id === 'kaiju')?.source).toBe('built-in');
    expect(files.filter((f) => !f.genre).map((f) => f.source)).toEqual(['user']);
  });

  test('a user genre is offered, accepted by the script check and sent to the image model', () => {
    const catalog = [...GENRES, parseGenreFile(PIRATES).genre!];
    const offered = genreOptions(
      GENRES.map((g) => g.id),
      { catalog, count: 1 },
    );
    expect(offered[0]).toMatchObject({ id: 'build-pirates', notes: 'Keep the sea shanties short.' });
    expect(genreOptions([], { pinned: 'build-pirates', catalog })[0]!.setting).toContain('galleon');

    const s = anchoredStory('vertical');
    s.genre = 'build-pirates';
    expect(pagePrompt(s, catalog)).toContain('Genre: Build pirates, set in a leaky galleon');
    expect(artPrompt(s.panels[0]!, 0, s, catalog)).toContain('Genre: Build pirates');
    // Without the catalog the id is only a phrase.
    expect(pagePrompt(s)).toContain('Genre: build-pirates;');
    delete s.genre;
    const missing = checkScript(s, { genres: catalog }).find((p) => p.where === 'genre');
    expect(missing?.problem).toContain('build-pirates');
  });

  test('genre list and genre check from the CLI', () => {
    const { env, dir } = userConfig({ 'pirates.md': PIRATES, 'broken.md': '---\nid: x\n---\n' });
    const { root } = makeRepo();
    const run = (...args: string[]) =>
      spawnSync('bun', [CLI, ...args], { cwd: root, env, encoding: 'utf8' });

    const list = run('genre', 'list', '--json');
    expect(list.status).toBe(0);
    const out = JSON.parse(list.stdout);
    expect(out.genres.find((g: { id: string }) => g.id === 'build-pirates').source).toBe('user');
    expect(out.invalid).toHaveLength(1);
    expect(out.folders.user).toBe(join(dir, 'genres'));

    expect(run('genre', 'check', join(dir, 'genres', 'pirates.md')).status).toBe(0);
    const bad = run('genre', 'check', join(dir, 'genres', 'broken.md'), '--json');
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).ok).toBe(false);
  });
});

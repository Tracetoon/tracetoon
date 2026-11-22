import { describe, expect, test } from 'bun:test';
import { comicSummary } from '../src/comic/composition.ts';
import { parseGenreFile, parseScenes } from '../src/comic/genreFile.ts';
import { GENRES, genreById, SCENE_SETTINGS, sceneOptions } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { pagePrompt } from '../src/comic/providers.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

describe('the built-in scene library', () => {
  test('space opera has 50 scenes and every other genre at least 12', () => {
    expect(genreById('space-opera')!.scenes!.length).toBe(50);
    for (const g of GENRES) expect(g.scenes!.length).toBeGreaterThanOrEqual(12);
  });

  test('scenes are well formed, unique, varied and name no franchise', () => {
    for (const g of GENRES) {
      const ids = g.scenes!.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      const kinds = new Set(g.scenes!.map((s) => s.setting));
      expect(kinds.size).toBeGreaterThanOrEqual(3);
      // Rooms are a minority: comics shouldn't all happen at a desk.
      expect(g.scenes!.filter((s) => s.setting === 'interior').length).toBeLessThanOrEqual(Math.ceil(g.scenes!.length * 0.3));
      for (const s of g.scenes!) {
        expect(SCENE_SETTINGS).toContain(s.setting);
        expect(/^[a-z0-9][a-z0-9-]*$/.test(s.id)).toBe(true);
        expect(s.cast.length).toBeGreaterThanOrEqual(2);
        expect(s.visualTropes.length).toBeGreaterThanOrEqual(3);
        expect(s.jokeHooks.length).toBeGreaterThanOrEqual(2);
        const text = [s.title, s.place, s.situation, ...s.cast, ...s.visualTropes, ...s.jokeHooks].join(' | ');
        expect(FRANCHISE_NAMES.exec(text)?.[0] ?? null).toBeNull();
      }
    }
  });
});

describe('scene rotation', () => {
  const space = genreById('space-opera')!;

  test('offers four scenes spread across settings, stable for a seed', () => {
    const a = sceneOptions(space, [], { seed: 'repo main' });
    expect(a).toHaveLength(4);
    expect(new Set(a.map((s) => s.setting)).size).toBe(4);
    expect(sceneOptions(space, [], { seed: 'repo main' })).toEqual(a);
    expect(sceneOptions(space, [], { seed: 'repo other' }).map((s) => s.id)).not.toEqual(a.map((s) => s.id));
  });

  test('skips scenes the last ten comics used', () => {
    const first = sceneOptions(space, [], { seed: 's' }).map((s) => s.id);
    const next = sceneOptions(space, first, { seed: 's' }).map((s) => s.id);
    expect(next.some((id) => first.includes(id))).toBe(false);
    expect(sceneOptions(undefined, [], {})).toEqual([]);
  });

  test('a scene repeated from a recent comic warns, and the summary records it', () => {
    const s = { ...pageScript(), scene: 'desert-cantina' } as ComicScript;
    expect(comicSummary(s).scene).toBe('desert-cantina');
    const findings = checkScript(s, { recentComics: [{ scene: 'desert-cantina' }] });
    expect(findings.some((p) => p.where === 'scene' && p.severity === 'warning')).toBe(true);
    expect(errors(checkScript({ ...s, scene: 'Not An Id!' } as ComicScript)).map((p) => p.where)).toContain('scene');
  });

  test('the packet offers scenes per genre and tells the author to pick one', () => {
    const files = comicPacketFiles({
      brief: 'b',
      description: 'd',
      genres: [{ id: 'space-opera', name: 'Space opera', setting: 's', archetypes: [], props: [], jokeHooks: [] }],
      sceneOptions: { 'space-opera': sceneOptions(space, [], { seed: 'x' }) },
      skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' },
      checkCommand: 'tracetoon comic check',
    });
    const ctx = JSON.parse(files['context.json']!);
    expect(ctx.sceneOptions['space-opera']).toHaveLength(4);
    expect(files['instructions.md']).toContain('sceneOptions');
  });

  test("the image prompt stages the comic in its scene's place", () => {
    const pick = space.scenes![0]!;
    const s = { ...pageScript(), genre: 'space-opera', scene: pick.id } as ComicScript;
    expect(pagePrompt(s)).toContain(pick.place);
    expect(pagePrompt(s)).toContain('genre parody of familiar tropes and settings is welcome');
  });
});

describe('scenes in genre files', () => {
  const file = `---
id: build-pirates
name: Build pirates
setting: a leaky galleon in a storm of failing builds
archetypes:
  - one-eyed captain
props:
  - treasure map
---
Notes for the author.

## Scene: leaky-bilge
title: Bailing out the bilge
setting: action
place: The flooded bilge of a galleon in a storm
situation: Every patched leak springs two more
cast: one-eyed captain; parrot that repeats log lines
visualTropes: lanterns swinging; water spraying from planks; a chain of buckets
jokeHooks: every patched leak opens two more, like flaky tests; the parrot repeats the error log
`;

  test('parses notes and scene sections', () => {
    const r = parseGenreFile(file);
    expect(r.problems.filter((p) => p.severity !== 'warning')).toEqual([]);
    expect(r.genre!.notes).toBe('Notes for the author.');
    expect(r.genre!.scenes).toHaveLength(1);
    expect(r.genre!.scenes![0]).toMatchObject({ id: 'leaky-bilge', setting: 'action', cast: ['one-eyed captain', 'parrot that repeats log lines'] });
  });

  test('a bad scene is reported with where to fix it, and franchise names warn', () => {
    const r = parseScenes('## Scene: Bad Id\nsetting: indoors\n\n## Scene: ok-one\ntitle: T\nsetting: crowd\nplace: P with a jedi\nsituation: S\ncast: a; b\nvisualTropes: a; b; c\njokeHooks: a; b');
    const where = r.problems.map((p) => p.where);
    expect(where).toContain('scenes[0].id');
    expect(where).toContain('scenes[0].setting');
    expect(r.problems.find((p) => p.where === 'scenes[1].place')?.severity).toBe('warning');
  });
});

import { describe, expect, test } from 'bun:test';
import { lookSimilarity } from '../src/comic/casting.ts';
import { comicSummary } from '../src/comic/composition.ts';
import { parseGenreFile } from '../src/comic/genreFile.ts';
import { genreById, genreOptions } from '../src/comic/genres.ts';
import { BUILT_IN_MEMES, memeOffer, parseMemeEntry, stylePick } from '../src/comic/memes.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';
import { ROSTER_GENRE_ID, rosterGenre } from './rosterGenre.ts';

const genre = rosterGenre();
const catalog = [genre];

const seeds = Array.from({ length: 2000 }, (_, i) => `repo head run-${i}`);

describe('genre meme pools', () => {
  test('anime-fantasy: casts from the isekai guide; its scenes come at the packet step, not a generic meme pool', () => {
    const anime = genreById('anime-fantasy')!;
    expect(anime.isekai).toBe(true);
    for (const key of ['cast', 'diverseCast', 'leads', 'memes', 'styleMix'] as const) expect(anime[key]).toBeUndefined();
    expect(genreOptions([], { pinned: 'anime-fantasy', seed: 's' })[0]!.memeOffer).toBeUndefined();
  });

  for (const id of ['space-opera']) {
    test(`${id}: hundreds of memes, no names, no near-duplicates, tiers spread`, () => {
      const pool = BUILT_IN_MEMES[id]!;
      expect(genreById(id)!.memes).toBe(pool);
      expect(pool.length).toBeGreaterThanOrEqual(200);
      expect(new Set(pool.map((m) => m.id)).size).toBe(pool.length);
      for (const m of pool) {
        expect(FRANCHISE_NAMES.test(`${m.meme} ${m.use}`)).toBe(false);
        expect(m.meme.length).toBeLessThanOrEqual(150);
        expect(m.use.length).toBeLessThanOrEqual(110);
      }
      for (let i = 0; i < pool.length; i++)
        for (let j = i + 1; j < pool.length; j++) expect(lookSimilarity(pool[i]!.meme, pool[j]!.meme)).toBeLessThan(0.5);
      const share = (t: number) => pool.filter((m) => m.tier === t).length / pool.length;
      expect(share(1)).toBeGreaterThan(0.15);
      expect(share(1)).toBeLessThan(0.35);
      expect(share(3)).toBeGreaterThan(0.15);
    });
  }
});

describe('meme offers', () => {
  const pool = BUILT_IN_MEMES['space-opera']!;

  test('three distinct memes, stable for a seed, covering the pool, tier 1 favoured', () => {
    const offers = seeds.map((s) => memeOffer(pool, s)!);
    for (const o of offers) {
      expect(o).toHaveLength(3);
      expect(new Set(o.map((m) => m.id)).size).toBe(3);
    }
    expect(memeOffer(pool, seeds[5]!)).toEqual(offers[5]!);
    const count = new Map<string, number>();
    for (const o of offers) for (const m of o) count.set(m.id, (count.get(m.id) ?? 0) + 1);
    expect(count.size / pool.length).toBeGreaterThan(0.9);
    const perMeme = (t: number) => {
      const ids = pool.filter((m) => m.tier === t).map((m) => count.get(m.id) ?? 0);
      return ids.reduce((s, n) => s + n, 0) / ids.length;
    };
    expect(perMeme(1)).toBeGreaterThan(perMeme(3) * 1.8);
  });

  test('skips recent memes and prefers the cast roles', () => {
    const first = memeOffer(pool, 'seed-a')!;
    const next = memeOffer(pool, 'seed-a', { recent: first.map((m) => m.id) })!;
    expect(next.some((m) => first.some((f) => f.id === m.id))).toBe(false);
    for (const s of seeds.slice(0, 200))
      for (const m of memeOffer(pool, s, { roles: ['villain'] })!) expect(m.roles.includes('any') || m.roles.includes('villain')).toBe(true);
    expect(memeOffer(undefined, 'x')).toBeUndefined();
  });

  test('an anime style mix assigns manga to about one comic in six', () => {
    const mix = genre.styleMix!;
    const picks = seeds.map((s) => stylePick(mix, s));
    const manga = picks.filter((p) => p === 'shonen-action').length / picks.length;
    expect(manga).toBeGreaterThan(0.12);
    expect(manga).toBeLessThan(0.22);
    expect(picks.filter((p) => p === 'anime-fantasy').length / picks.length).toBeGreaterThan(0.48);
    expect(stylePick(undefined, 'x')).toBeUndefined();
    expect(genreOptions([], { pinned: 'space-opera', seed: 's' })[0]!.assignedStyle).toBeUndefined();
  });

  test('genre files carry memes and a style mix', () => {
    const text = `---
id: tiny-space
name: Tiny space
setting: a ship
archetypes:
  - captain
props:
  - console
styleMix:
  - webcomic 2
  - noir 1
memes:
  - 1 captain: a captain says engage — starting a deploy
  - 2 any: a red-shirted crewman beams down — a test that always fails first
  - 9 any: not a valid tier — never parsed
---
`;
    expect(parseGenreFile(text).problems.map((p) => p.where)).toContain('memes[2]');
    const ok = parseGenreFile(text.replace('  - 9 any: not a valid tier — never parsed\n', ''));
    expect(ok.genre?.memes?.map((m) => m.tier)).toEqual([1, 2]);
    expect(ok.genre?.styleMix).toEqual({ webcomic: 2, noir: 1 });
    expect(parseMemeEntry('2 hero,mage: x — y')).toEqual({ tier: 2, roles: ['hero', 'mage'], meme: 'x', use: 'y' });
  });

  test('the packet offers the memes and style; the check holds the script to them; the summary remembers the meme', () => {
    const option = genreOptions([], { pinned: ROSTER_GENRE_ID, catalog, seed: 'seed-9' })[0]!;
    const files = comicPacketFiles({
      brief: 'b',
      description: 'd',
      genres: [option],
      skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' },
      checkCommand: 'tracetoon comic check',
    });
    expect(JSON.parse(files['context.json']!).genreOptions[0].memeOffer).toHaveLength(3);
    expect(files['instructions.md']).toContain('never name the work');
    expect(files['instructions.md']).toContain('assignedStyle');

    const opts = { genreOptions: [option] };
    const base = {
      ...pageScript(),
      genre: ROSTER_GENRE_ID,
      style: option.assignedStyle!,
      personas: option.castOffer!.personas.slice(0, 2).map((p) => p.id),
    } as ComicScript;
    expect(errors(checkScript(base, opts)).filter((p) => p.where === 'meme' || p.where === 'style')).toHaveLength(0);
    const meme = option.memeOffer![0]!.id;
    expect(errors(checkScript({ ...base, meme }, opts)).filter((p) => p.where === 'meme')).toHaveLength(0);
    expect(errors(checkScript({ ...base, meme: 'not-offered' }, opts)).map((p) => p.where)).toContain('meme');
    const other = ['anime-fantasy', 'shonen-action'].find((s) => s !== option.assignedStyle)!;
    expect(errors(checkScript({ ...base, style: other }, opts)).map((p) => p.where)).toContain('style');
    expect(comicSummary({ ...base, meme }).meme).toBe(meme);
  });
});

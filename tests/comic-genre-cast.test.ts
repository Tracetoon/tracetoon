import { describe, expect, test } from 'bun:test';
import animeRaw from '../src/comic/cast/anime-fantasy.json' with { type: 'json' };
import spaceRaw from '../src/comic/cast/space-opera.json' with { type: 'json' };
import { lookSimilarity } from '../src/comic/casting.ts';
import { parseGenreFile } from '../src/comic/genreFile.ts';
import { genreById, genreOptions } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

/** Present-day nationalities and ethnic labels: out of place inside a fantasy world. */
const REAL_WORLD = /\b(african|asian|european|latin[oa]|latinx|arab|indian|japanese|chinese|korean|american|jamaican|irish|scottish|nigerian|mexican|brazilian|samoan|hawaiian|polish|lebanese|filipin[oa]|vietnamese|ethiopian|ghanaian|peruvian|navajo|m[aā]ori)\b/i;
/** Pop-culture styling tells the genres' source works don't use to mark identity. */
const STYLING_TELL = /\b(undercut|shaved sides|side-shaved|pride (pin|flag|badge)|rainbow (pin|flag|badge))\b/i;

describe('genre-true diverse archetypes', () => {
  for (const [id, raw] of [['anime-fantasy', animeRaw], ['space-opera', spaceRaw]] as const) {
    test(`${id}: a large list from the genre, no names, no real-world labels or styling tells, about a quarter LGBTQ+`, () => {
      const list = genreById(id)!.diverseCast!;
      expect(list.length).toBeGreaterThanOrEqual(100);
      expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
      for (const p of list) {
        const text = `${p.name} ${p.details}`;
        expect(FRANCHISE_NAMES.test(text)).toBe(false);
        expect(STYLING_TELL.test(text)).toBe(false);
        if (id === 'anime-fantasy') expect(REAL_WORLD.test(text)).toBe(false);
      }
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) expect(lookSimilarity(list[i]!.name, list[j]!.name)).toBeLessThan(0.6);
      const lgbtq = (raw as { lgbtq: boolean }[]).filter((r) => r.lgbtq).length / raw.length;
      expect(lgbtq).toBeGreaterThanOrEqual(0.2);
      expect(lgbtq).toBeLessThanOrEqual(0.4);
    });
  }

  test('anime fantasy: a required archetype joins the cast offer in place of its role', () => {
    const seeds = Array.from({ length: 600 }, (_, i) => `repo head ${i}`);
    const options = seeds.map((s) => genreOptions([], { pinned: 'anime-fantasy', seed: s })[0]!);
    const withRequired = options.filter((o) => o.castOffer!.personas.some((p) => p.required));
    expect(withRequired.length / options.length).toBeGreaterThan(0.15);
    expect(withRequired.length / options.length).toBeLessThan(0.25);
    for (const o of options) {
      expect(o.castOffer!.personas).toHaveLength(5);
      expect(o.requiredCast).toBeUndefined();
    }
  });

  test('space opera: a required archetype for a genre without a cast offer; the check holds the script to it', () => {
    const seed = Array.from({ length: 200 }, (_, i) => `s${i}`).find((s) => genreOptions([], { pinned: 'space-opera', seed: s })[0]!.requiredCast)!;
    const option = genreOptions([], { pinned: 'space-opera', seed })[0]!;
    const required = option.requiredCast!;
    const opts = { genreOptions: [option] };
    const base = { ...pageScript(), genre: 'space-opera' } as ComicScript;
    expect(errors(checkScript(base, opts)).map((p) => p.where)).toContain('personas');
    expect(errors(checkScript({ ...base, personas: ['someone-else'] }, opts)).find((p) => p.where === 'personas')?.problem).toContain(required.name);
    expect(errors(checkScript({ ...base, personas: [required.id] }, opts)).filter((p) => p.where.startsWith('personas'))).toHaveLength(0);
    // A comic without a required archetype has no persona requirement.
    const free = Array.from({ length: 200 }, (_, i) => `f${i}`).map((s) => genreOptions([], { pinned: 'space-opera', seed: s })[0]!).find((o) => !o.requiredCast)!;
    expect(checkScript(base, { genreOptions: [free] }).some((p) => p.where.startsWith('personas'))).toBe(false);
    const files = comicPacketFiles({
      brief: 'b', description: 'd', genres: [option], skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' }, checkCommand: 'tracetoon comic check',
    });
    expect(JSON.parse(files['context.json']!).genreOptions[0].requiredCast.id).toBe(required.id);
    expect(files['instructions.md']).toContain('through what the characters say and do');
  });

  test('a genre without an archetype list never requires one', () => {
    for (let i = 0; i < 200; i++) {
      const o = genreOptions([], { pinned: 'cyberpunk', seed: `c${i}` })[0]!;
      expect(o.requiredCast).toBeUndefined();
    }
  });

  test('genre files carry a diverse cast with any role word', () => {
    const text = `---
id: tiny-saga
name: Tiny saga
setting: a ship
archetypes:
  - captain
props:
  - console
diverseCast:
  - captain: a commanding station captain — shaved head, a baseball on the desk
  - engineer: two married engineers — finish each other's diagnostics
---
`;
    const r = parseGenreFile(text);
    expect(r.problems.filter((p) => p.severity !== 'warning')).toEqual([]);
    expect(r.genre?.diverseCast?.map((p) => p.role)).toEqual(['captain', 'engineer']);
  });
});

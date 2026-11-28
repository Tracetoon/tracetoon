import { describe, expect, test } from 'bun:test';
import { ARCHETYPES, isekaiCast } from '../src/comic/isekai/casting.ts';
import data from '../src/comic/isekai/presentation.json' with { type: 'json' };
import { bodyNote, presentationOf, SPECIES_WORDS, type Presentation } from '../src/comic/isekai/presentation.ts';
import { negativeFor, pagePrompt } from '../src/comic/providers.ts';
import { genreOptions } from '../src/comic/genres.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const ALL = data as Record<string, Presentation>;

describe('presentation: how non-human archetypes are drawn', () => {
  test('every entry is a known archetype, with a base, plain traits, an avoid-list and sources; no names', () => {
    for (const [id, p] of Object.entries(ALL)) {
      expect(ARCHETYPES[id]).toBeDefined();
      expect(['human', 'humanoid creature', 'creature', 'dual']).toContain(p.base);
      expect(p.presentation.length).toBeGreaterThan(10);
      expect(Array.isArray(p.notOnPage)).toBe(true);
      expect(p.sources.length).toBeGreaterThan(0);
      for (const text of [p.presentation, p.look ?? '']) {
        expect([id, FRANCHISE_NAMES.exec(text)?.[0]]).toEqual([id, undefined]);
        if (p.base === 'human') expect([id, SPECIES_WORDS.exec(text)?.[0]]).toEqual([id, undefined]);
      }
    }
  });

  test('the scaled spear guardian is a human with scale patches, not a reptile', () => {
    const p = presentationOf('P10')!;
    expect(p.base).toBe('human');
    expect(p.presentation).toContain('Human face and body');
    expect(p.look).not.toContain('reptilian');
    expect(p.look).not.toContain('ear-shaped');
    expect(bodyNote('P10')).toContain('human face and body');
    expect(SPECIES_WORDS.test('a tall lizardfolk woman')).toBe(true);
    expect(SPECIES_WORDS.test('a woman with orange scales')).toBe(false);
  });

  test('the packet member carries the verified presentation and the corrected look', () => {
    for (let i = 0; i < 400; i++) {
      const cast = isekaiCast(`present ${i}`);
      const m = [cast.lead, ...cast.companions, ...cast.contacts].find((x) => x.archetype === 'P10');
      if (!m) continue;
      expect(m.presentation).toBe(ALL.P10!.presentation);
      expect(m.look).toBe(ALL.P10!.look!);
      expect(m.notOnPage).toEqual(ALL.P10!.notOnPage);
      return;
    }
    throw new Error('no cast with P10 in 400 seeds');
  });

  const script = (description: string): ComicScript => {
    const s = pageScript() as ComicScript;
    return { ...s, characters: [{ name: 'Emberstep', description, archetype: 'P10' }], panels: s.panels.map((p) => ({ ...p, characters: [{ name: 'Emberstep', position: 'left' }] })) } as ComicScript;
  };

  test('the image prompt states the human body and keeps the creature traits out', () => {
    const s = script('Tall woman with long red hair and orange scale patches at the throat and forearms; carries a long spear.');
    const prompt = pagePrompt(s);
    expect(prompt).toContain('carries a long spear; a human face and body, with only the traits described');
    expect(negativeFor(s)).toContain('Emberstep with lizard head or snout, fully scaled face or body');
  });

  test('the check refuses a species word for a human-presenting archetype', () => {
    const option = genreOptions([], { pinned: 'anime-fantasy', seed: 'species' })[0]!;
    const opts = { genreOptions: [option] };
    const bad = (d: string) => errors(checkScript({ ...script(d), genre: 'anime-fantasy' }, opts)).filter((p) => p.problem.includes('animal-headed'));
    expect(bad('Tall athletic adult lizardfolk woman with a thick tail.')).toHaveLength(1);
    expect(bad('Tall woman with orange scale patches at the throat.')).toHaveLength(0);
  });
});

describe('the author sees the audited body, never the species label', () => {
  test('audited members carry no species label, and no core or variant contradicts the body', () => {
    const suspect = /\b([a-z]+folk|reptil\w*|lizard\w*|monstrous\w*)\b/i;
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      const cast = isekaiCast(`label ${i}`);
      for (const m of [cast.lead, ...cast.companions, ...cast.contacts]) {
        if (!presentationOf(m.archetype)) continue;
        seen++;
        expect([m.archetype, m.species]).toEqual([m.archetype, undefined]);
        for (const t of [m.core, ...m.variants]) expect([m.archetype, suspect.exec(t)?.[0]]).toEqual([m.archetype, undefined]);
      }
    }
    expect(seen).toBeGreaterThan(50);
  });
});

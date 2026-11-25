import { describe, expect, test } from 'bun:test';
import { castOffer, MAIN_ROLES, parseCastEntry, type CastPersona } from '../src/comic/casting.ts';
import { parseGenreFile } from '../src/comic/genreFile.ts';
import { genreById, genreOptions } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import { styleById } from '../src/comic/styles.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const anime = genreById('anime-fantasy')!;
const roster = anime.cast!;
const offers = Array.from({ length: 2000 }, (_, i) => castOffer(roster, `repo head run-${i}`)!);

describe('anime fantasy genre', () => {
  test('has a full roster, a colour anime style, and names no source series', () => {
    expect(roster.length).toBeGreaterThanOrEqual(36);
    for (const role of [...MAIN_ROLES, 'nemesis', 'side'] as const)
      expect(roster.filter((p) => p.role === role).length).toBeGreaterThanOrEqual(3);
    expect(roster.filter((p) => p.role === 'mage').length).toBeGreaterThanOrEqual(4);
    expect(new Set(roster.map((p) => p.id)).size).toBe(roster.length);
    expect(anime.styles[0]).toBe('anime-fantasy');
    expect(styleById('anime-fantasy')?.palettes).toEqual(['full-color']);
    const text = [anime.setting, ...anime.archetypes, ...anime.jokeHooks, anime.notes, ...roster.map((p) => `${p.name} ${p.details}`)].join(' | ');
    expect(FRANCHISE_NAMES.exec(text)).toBeNull();
    for (const name of ['Frieren', 'Megumin', 'Kazuma', 'Re:Zero', 'Solo Leveling', 'Konosuba', 'Witch Hat Atelier'])
      expect(FRANCHISE_NAMES.test(name)).toBe(true);
    expect(anime.notes).toContain('never servants or captives');
    expect(anime.notes).toContain('no fan');
  });

  test('a genre file carries a cast roster', () => {
    const text = `---
id: tiny-isekai
name: Tiny isekai
setting: a village
archetypes:
  - villager
props:
  - sign
cast:
  - hero: a lost hero — keeps asking for directions
  - side: a baker — bakes bread
  - wizard: a wizard — not a known role
---
`;
    const bad = parseGenreFile(text);
    expect(bad.problems.map((p) => p.where)).toContain('cast[2]');
    const ok = parseGenreFile(text.replace('  - wizard: a wizard — not a known role\n', ''));
    expect(ok.genre?.cast?.map((p) => p.id)).toEqual(['lost-hero', 'baker']);
    expect(parseCastEntry('mage: an ageless elf mage — collects spells')).toEqual({
      id: 'ageless-elf-mage',
      role: 'mage',
      name: 'an ageless elf mage',
      details: 'collects spells',
    } satisfies CastPersona);
  });
});

describe('cast offers', () => {
  test('always five, stable for a seed, about one in five side-only', () => {
    for (const o of offers) expect(o.personas).toHaveLength(5);
    expect(castOffer(roster, 'repo head run-7')).toEqual(offers[7]!);
    const sideOnly = offers.filter((o) => o.kind === 'side-only').length / offers.length;
    expect(sideOnly).toBeGreaterThan(0.15);
    expect(sideOnly).toBeLessThan(0.25);
  });

  test('a party offer is three main roles, a nemesis and a side character; side-only has no main cast', () => {
    for (const o of offers) {
      const roles = o.personas.map((p) => p.role);
      if (o.kind === 'party') {
        const main = roles.filter((r) => (MAIN_ROLES as readonly string[]).includes(r));
        expect(new Set(main).size).toBe(3);
        expect(roles.filter((r) => r === 'nemesis')).toHaveLength(1);
        expect(roles.filter((r) => r === 'side')).toHaveLength(1);
      } else {
        expect(roles.filter((r) => (MAIN_ROLES as readonly string[]).includes(r))).toHaveLength(0);
        expect(roles.filter((r) => r === 'nemesis')).toHaveLength(1);
      }
    }
  });

  test('every persona is offered and none more than twice its fair share within its role', () => {
    const count = new Map<string, number>();
    for (const o of offers) for (const p of o.personas) count.set(p.id, (count.get(p.id) ?? 0) + 1);
    expect(count.size).toBe(roster.length);
    for (const role of [...MAIN_ROLES, 'nemesis', 'side'] as const) {
      const ids = roster.filter((p) => p.role === role).map((p) => count.get(p.id)!);
      const fair = ids.reduce((s, n) => s + n, 0) / ids.length;
      expect(Math.max(...ids)).toBeLessThan(fair * 2);
    }
  });

  test('a genre without a roster has no offer, and options show only the offered personas', () => {
    expect(castOffer(undefined, 'x')).toBeUndefined();
    expect(genreOptions([], { pinned: 'space-opera', seed: 's' })[0]!.castOffer).toBeUndefined();
    const option = genreOptions([], { pinned: 'anime-fantasy', seed: 's' })[0]!;
    expect(option.archetypes).toEqual(option.castOffer!.personas.map((p) => p.name));
    expect(option.archetypes).toHaveLength(5);
  });

  test('the packet passes the five and explains the offer; the check enforces it', () => {
    const option = genreOptions([], { pinned: 'anime-fantasy', seed: 'seed-1' })[0]!;
    const files = comicPacketFiles({
      brief: 'b',
      description: 'd',
      genres: [option],
      skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' },
      checkCommand: 'tracetoon comic check',
    });
    const ctx = JSON.parse(files['context.json']!);
    expect(ctx.genreOptions[0].castOffer.personas).toHaveLength(5);
    expect(files['context.json']).not.toContain(roster.find((p) => !option.castOffer!.personas.includes(p))!.details);
    expect(files['instructions.md']).toContain('cast from those five only');

    const offered = option.castOffer!.personas.map((p) => p.id);
    const base = { ...pageScript(), genre: 'anime-fantasy' } as ComicScript;
    const opts = { genreOptions: [option] };
    expect(errors(checkScript(base, opts)).map((p) => p.where)).toContain('personas');
    // A required archetype in the offer (about one comic in five) must be among them.
    const required = option.castOffer!.personas.find((p) => p.required)?.id;
    const cast = [...new Set([...offered.slice(0, 3), ...(required ? [required] : [])])];
    expect(errors(checkScript({ ...base, personas: cast }, opts)).filter((p) => p.where.startsWith('personas'))).toHaveLength(0);
    if (required) expect(errors(checkScript({ ...base, personas: offered.filter((id) => id !== required).slice(0, 2) }, opts)).map((p) => p.where)).toContain('personas');
    const stranger = roster.find((p) => !offered.includes(p.id))!.id;
    expect(errors(checkScript({ ...base, personas: [offered[0]!, stranger] }, opts)).map((p) => p.where)).toContain('personas[1]');
    // No offer, no requirement.
    expect(checkScript({ ...base, genre: 'space-opera' } as ComicScript, opts).some((p) => p.where.startsWith('personas'))).toBe(false);
  });

  test('a side-only offer refuses the main cast', () => {
    const seed = Array.from({ length: 200 }, (_, i) => `side-${i}`).find((s) => genreOptions([], { pinned: 'anime-fantasy', seed: s })[0]!.castOffer!.kind === 'side-only')!;
    const option = genreOptions([], { pinned: 'anime-fantasy', seed })[0]!;
    const hero = roster.find((p) => p.role === 'hero')!.id;
    const found = errors(checkScript({ ...pageScript(), genre: 'anime-fantasy', personas: [option.castOffer!.personas[0]!.id, hero] } as ComicScript, { genreOptions: [option] }));
    expect(found.find((p) => p.where === 'personas[1]')?.problem).toContain('side characters only');
  });
});

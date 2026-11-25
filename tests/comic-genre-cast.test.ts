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
    // A comic without a required archetype still has its lead, and nothing else to cast.
    const free = Array.from({ length: 200 }, (_, i) => `f${i}`).map((s) => genreOptions([], { pinned: 'space-opera', seed: s })[0]!).find((o) => !o.requiredCast)!;
    const freeLead = free.lead!;
    const leadOnly = { ...base, personas: [freeLead.id], lead: { persona: freeLead.id, name: 'Ace' }, characters: [{ name: 'Ace', description: 'd' }] } as ComicScript;
    expect(errors(checkScript(leadOnly, { genreOptions: [free] })).filter((p) => p.where.startsWith('personas') || p.where === 'lead')).toHaveLength(0);
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

describe('a main character in every comic', () => {
  test('every comic of a genre with leads gets one; diverse leads take about 60%; recent leads are skipped', () => {
    const anime = genreById('anime-fantasy')!.leads!;
    expect(anime.length).toBeGreaterThanOrEqual(50);
    expect(genreById('space-opera')!.leads!.length).toBeGreaterThanOrEqual(50);
    const counts = { stereotype: 0, diverse: 0 };
    for (let i = 0; i < 3000; i++) {
      const o = genreOptions([], { pinned: 'anime-fantasy', seed: `lead-${i}` })[0]!;
      const leads = o.castOffer!.personas.filter((p) => p.lead);
      expect(leads).toHaveLength(1);
      counts[leads[0]!.role === 'stereotype' ? 'stereotype' : 'diverse']++;
    }
    const share = counts.diverse / 3000;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.65);
    const first = genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!.lead!;
    for (let i = 0; i < 200; i++) expect(genreOptions([], { pinned: 'space-opera', seed: `y${i}`, recentLeads: [first.id] })[0]!.lead!.id).not.toBe(first.id);
    for (const l of anime) expect(FRANCHISE_NAMES.test(`${l.name} ${l.details}`)).toBe(false);
  });

  test('the lead never replaces a required archetype, and a side-only comic gets a side or nemesis archetype', () => {
    for (let i = 0; i < 1500; i++) {
      const o = genreOptions([], { pinned: 'anime-fantasy', seed: `p${i}` })[0]!;
      const ps = o.castOffer!.personas;
      expect(ps.filter((p) => p.required && p.lead)).toHaveLength(0);
      const req = ps.find((p) => p.required);
      if (o.castOffer!.kind === 'side-only' && req) expect(['side', 'nemesis']).toContain(req.role);
    }
  });

  test('the check requires the lead as a named character and warns when they are in few panels', () => {
    const option = genreOptions([], { pinned: 'space-opera', seed: 'lead-check' })[0]!;
    const lead = option.lead!;
    const required = option.requiredCast;
    const opts = { genreOptions: [option] };
    const base = { ...pageScript(), genre: 'space-opera', personas: [lead.id, ...(required ? [required.id] : [])] } as ComicScript;
    expect(errors(checkScript(base, opts)).map((p) => p.where)).toContain('lead');
    const name = base.characters[0]!.name;
    const ok = { ...base, lead: { persona: lead.id, name } } as ComicScript;
    expect(errors(checkScript(ok, opts)).filter((p) => p.where === 'lead')).toHaveLength(0);
    expect(errors(checkScript({ ...ok, lead: { persona: lead.id, name: 'Nobody' } }, opts)).map((p) => p.where)).toContain('lead');
    const few = { ...ok, panels: ok.panels.map((p, i) => (i === 0 ? p : { ...p, characters: (p.characters ?? []).filter((c) => c.name !== name) })) } as ComicScript;
    if (few.panels.length >= 3) expect(checkScript(few, opts).some((p) => p.where === 'lead' && p.severity === 'warning')).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { DIVERSE_RATE, diverseHint, lookSimilarity, SAME_LOOK, withRequired, type CastPersona } from '../src/comic/casting.ts';
import { comicSummary } from '../src/comic/composition.ts';
import { genreById } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

describe('casting by rotation', () => {
  const list: CastPersona[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, role: i % 2 ? 'captain' : 'warrior', name: `persona ${i}`, details: 'd' }) as CastPersona);

  test('about one comic in five must cast a genre archetype, stable for its seed, spread evenly', () => {
    expect(DIVERSE_RATE).toBe(1 / 5);
    const seeds = Array.from({ length: 6000 }, (_, i) => `repo branch run-${i}`);
    const hints = seeds.map((s) => diverseHint(list, s));
    const share = hints.filter(Boolean).length / seeds.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(diverseHint(list, 'repo branch run-7')).toEqual(hints[7]);
    expect(hints.every((h) => !h || h.required)).toBe(true);
    const counts = new Map<string, number>();
    for (const h of hints) if (h) counts.set(h.id, (counts.get(h.id) ?? 0) + 1);
    expect(counts.size).toBe(list.length);
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    expect(Math.max(...counts.values()) / total).toBeLessThan(2 / list.length);
    expect(diverseHint(undefined, 'x')).toBeUndefined();
    expect(diverseHint([], 'x')).toBeUndefined();
  });

  test('a required archetype takes the place of the offered persona with its role', () => {
    const offer = { kind: 'party' as const, personas: ['hero', 'mage', 'warrior', 'nemesis', 'side'].map((role) => ({ id: role, role, name: role, details: '' }) as CastPersona) };
    const req = { id: 'dark-elf-knight', role: 'warrior', name: 'a dark-skinned elf knight', details: 'd', required: true } as CastPersona;
    expect(withRequired(offer, req).personas.map((p) => p.id)).toEqual(['hero', 'mage', 'dark-elf-knight', 'nemesis', 'side']);
    const captain = { ...req, id: 'captain', role: 'captain' } as CastPersona;
    expect(withRequired(offer, captain).personas.map((p) => p.id)).toEqual(['hero', 'mage', 'warrior', 'nemesis', 'captain']);
  });

  test('look similarity catches the same design in other words', () => {
    expect(lookSimilarity('older woman, dark skin, silver hair', 'older woman with silver hair and dark skin')).toBeGreaterThanOrEqual(SAME_LOOK);
    expect(lookSimilarity('wiry young man, bald, orange flight suit', 'older woman, dark skin, silver hair')).toBeLessThan(SAME_LOOK);
  });

  test("a lead who looks like a recent comic's lead warns, and the summary records the look", () => {
    const s = { ...pageScript(), leadLook: 'Older woman, dark skin, silver hair' } as ComicScript;
    expect(comicSummary(s).leadLook).toBe('older woman, dark skin, silver hair');
    const findings = checkScript(s, { recentComics: [{ leadLook: 'older woman with silver hair, dark skin' }] });
    expect(findings.some((p) => p.where === 'leadLook' && p.severity === 'warning')).toBe(true);
    expect(checkScript(s, { recentComics: [{ leadLook: 'teenage boy, red hoodie' }] }).some((p) => p.where === 'leadLook')).toBe(false);
    expect(errors(checkScript({ ...s, leadLook: 'x'.repeat(90) } as ComicScript)).map((p) => p.where)).toContain('leadLook');
  });

  test('the packet never carries a generic cast hint', () => {
    const files = comicPacketFiles({
      brief: 'b',
      description: 'd',
      genres: [],
      skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' },
      checkCommand: 'tracetoon comic check',
    });
    expect(JSON.parse(files['context.json']!).castHint).toBeUndefined();
    expect(files['instructions.md']).not.toContain('castHint');
    expect(files['instructions.md']).not.toContain('required');
  });
});

describe('space opera fights', () => {
  test('the genre offers fight recipes and comic combat without franchise names', () => {
    const g = genreById('space-opera')!;
    expect(g.jokeHooks.some((h) => /fighters/.test(h))).toBe(true);
    expect(g.archetypes).toContain('hotshot fighter ace');
    expect(g.notes).toContain('nobody gets hurt');
    expect(FRANCHISE_NAMES.exec([g.setting, ...g.archetypes, ...g.jokeHooks, g.notes].join(' | '))).toBeNull();
  });
});

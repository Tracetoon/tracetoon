import { describe, expect, test } from 'bun:test';
import { CAST_POOL, castHint, lookSimilarity, SAME_LOOK } from '../src/comic/casting.ts';
import { comicSummary } from '../src/comic/composition.ts';
import { genreById } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

describe('casting by rotation', () => {
  test('about one comic in five gets a hint, stable for its seed', () => {
    const seeds = Array.from({ length: 3000 }, (_, i) => `repo branch run-${i}`);
    const hints = seeds.map((s) => castHint(s));
    const share = hints.filter(Boolean).length / seeds.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(castHint('repo branch run-7')).toBe(hints[7]);
  });

  test('hints spread across the whole pool, none dominating', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 9000; i++) {
      const h = castHint(`seed-${i}`);
      if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    expect(counts.size).toBe(CAST_POOL.length);
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    expect(Math.max(...counts.values()) / total).toBeLessThan(0.06);
  });

  test('the pool is people, not roles, and mixes LGBTQ+ people with others', () => {
    expect(CAST_POOL.length).toBeGreaterThanOrEqual(30);
    const lgbtq = CAST_POOL.filter((p) => /husband|wife|married to each other|boyfriend|lesbian|trans|nonbinary|bisexual/.test(p));
    expect(lgbtq.length).toBeGreaterThan(5);
    expect(lgbtq.length).toBeLessThan(CAST_POOL.length / 2);
    expect(new Set(CAST_POOL).size).toBe(CAST_POOL.length);
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

  test('the packet passes a hint only when there is one', () => {
    const base = {
      brief: 'b',
      description: 'd',
      genres: [],
      skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' },
      checkCommand: 'tracetoon comic check',
    };
    const withHint = comicPacketFiles({ ...base, castHint: 'a trans man' });
    expect(JSON.parse(withHint['context.json']!).castHint).toBe('a trans man');
    expect(withHint['instructions.md']).toContain('never the topic or');
    const without = comicPacketFiles(base);
    expect(JSON.parse(without['context.json']!).castHint).toBeUndefined();
    expect(without['instructions.md']).not.toContain('castHint');
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

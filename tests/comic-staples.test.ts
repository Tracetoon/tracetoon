import { describe, expect, test } from 'bun:test';
import { genreOptions } from '../src/comic/genres.ts';
import { cooldownFrom, COOLDOWN, STAPLES, tropeOffer, TROPE_OFFER, TROPE_STAPLES } from '../src/comic/isekai/pitches.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript, ComicSummary } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

describe('isekai staples', () => {
  test('each recurs in at least 3 series, draws from cues, and names no work in what it shows', () => {
    expect(STAPLES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(STAPLES.map((s) => s.id)).size).toBe(STAPLES.length);
    for (const s of STAPLES) {
      expect(s.id).toMatch(/^[a-z0-9-]{1,80}$/);
      expect(s.series.length).toBeGreaterThanOrEqual(3);
      expect(s.cues.length).toBeGreaterThanOrEqual(3);
      expect(s.jokeHandles.length).toBeGreaterThanOrEqual(2);
      for (const t of [...s.cues, ...s.jokeHandles]) expect([s.id, FRANCHISE_NAMES.exec(t)?.[0]]).toEqual([s.id, undefined]);
    }
    for (const id of ['hero-summoning-ceremony', 'aptitude-measurement', 'status-window', 'absurdly-high-stats', 'lopsided-stat']) expect(STAPLES.map((s) => s.id)).toContain(id);
  });
});

describe('the trope offer', () => {
  test('three per comic, at least two staples, stable for a seed', () => {
    const offer = tropeOffer(['The cautious overpowered hero', 'Guild receptionist'], 'seed');
    expect(offer).toHaveLength(TROPE_OFFER);
    expect(offer.filter((t) => t.kind === 'staple').length).toBeGreaterThanOrEqual(TROPE_STAPLES);
    expect(tropeOffer(['The cautious overpowered hero', 'Guild receptionist'], 'seed')).toEqual(offer);
  });

  test('staples rest for 10 comics, memes are spent for 100', () => {
    const history: ComicSummary[] = [{ meme: 'status-window' }, { meme: 'fmt-049' }, ...Array.from({ length: 20 }, () => ({}))];
    const c = cooldownFrom(history);
    expect(c.staples).toEqual(['status-window']);
    expect(c.memes).toEqual(['fmt-049']);
    for (let i = 0; i < 200; i++) expect(tropeOffer([], `s ${i}`, c).map((t) => t.id)).not.toContain('status-window');
    expect(COOLDOWN.staples).toBe(10);
  });

  test('every anime option carries it, with or without the brainstorm', () => {
    expect(genreOptions([], { pinned: 'anime-fantasy', seed: 'x' })[0]!.tropeOffer).toHaveLength(TROPE_OFFER);
  });

  test('leads rest for 10 comics', () => {
    const base = genreOptions([], { pinned: 'anime-fantasy', seed: 'lead10' })[0]!;
    const lead = base.isekaiCast!.lead.archetype;
    const history: ComicSummary[] = [...Array.from({ length: 6 }, () => ({})), { lead }];
    const rested = genreOptions([], { pinned: 'anime-fantasy', seed: 'lead10', history })[0]!;
    expect(rested.isekaiCast!.lead.archetype).not.toBe(lead);
  });

  test('the comic may use one offered trope, never another', () => {
    const option = genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!;
    const withOffer = { ...option, tropeOffer: tropeOffer([], 'chk') };
    const s = { ...(pageScript() as ComicScript), genre: 'space-opera' };
    const memeErrors = (meme?: string) => errors(checkScript({ ...s, ...(meme ? { meme } : {}) } as ComicScript, { genreOptions: [withOffer] })).filter((p) => p.where === 'meme');
    expect(memeErrors()).toEqual([]);
    expect(memeErrors(withOffer.tropeOffer[0]!.id)).toEqual([]);
    expect(memeErrors('not-offered')).toHaveLength(1);
  });
});

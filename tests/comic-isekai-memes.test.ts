import { describe, expect, test } from 'bun:test';
import parity from './fixtures/isekai-meme-parity.json' with { type: 'json' };
import { ARCHETYPES, isekaiCast } from '../src/comic/isekai/casting.ts';
import {
  ISEKAI_MEMES,
  isekaiMemeOffer,
  matchContext,
  offerJoke,
  selectorMatches,
  suggest,
  SCENE_OFFER_SIZE,
} from '../src/comic/isekai/memeMatch.ts';
import { genreById, genreOptions, withSceneOffers } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

type ParityCase = {
  cast: string[];
  joke: string;
  counts: Record<string, number>;
  filtered: number;
  suggestions: { id: string; score: number; relevance: number; topics: string[]; assignment: Record<string, string> }[];
};

describe('the anime meme matcher, ported from match_memes.py', () => {
  test('suggestions, scores, slot assignments and eligibility counts match the original on 600 cases', () => {
    for (const c of parity.cases as ParityCase[]) {
      const r = suggest(matchContext(c.cast), c.joke);
      expect({ counts: r.counts, filtered: r.filtered }).toEqual({ counts: c.counts, filtered: c.filtered });
      expect(
        r.suggestions.map((s) => ({ id: s.id, score: s.score, relevance: s.relevance_score, topics: s.matched_topics, assignment: s.assignment })),
      ).toEqual(c.suggestions);
    }
  });

  test("every slot's selector picks exactly the research's precomputed eligible archetypes", () => {
    const everyone = Object.keys(ARCHETYPES).map((id) => matchContext([id]).characters[0]!);
    const eligibility = parity.eligibility as Record<string, Record<string, string[]>>;
    for (const m of ISEKAI_MEMES)
      for (const s of m.cast.slots)
        expect([m.id, s.slot, everyone.filter((a) => selectorMatches(s.selector, a)).map((a) => a.archetype_id).sort()]).toEqual([
          m.id,
          s.slot,
          [...(eligibility[m.id]![s.slot] ?? [])].sort(),
        ]);
  });

  test('the pool: 530 scenes, five focused on each archetype, every id known, no franchise names', () => {
    expect(ISEKAI_MEMES).toHaveLength(530);
    const focus = new Map<string, number>();
    for (const m of ISEKAI_MEMES) focus.set(m.focus_archetype_id, (focus.get(m.focus_archetype_id) ?? 0) + 1);
    expect(focus.size).toBe(Object.keys(ARCHETYPES).length);
    expect([...focus.values()].every((n) => n === 5)).toBe(true);
    for (const m of ISEKAI_MEMES) {
      for (const s of m.cast.slots) for (const id of [...(s.selector.ids_any ?? []), ...(s.selector.exclude_ids ?? [])]) expect(ARCHETYPES[id]).toBeDefined();
      for (const text of [m.title, m.meme, m.use]) expect([m.id, FRANCHISE_NAMES.exec(text)?.[0]]).toEqual([m.id, undefined]);
    }
  });
});

describe('the scene offer for one comic', () => {
  const joke = offerJoke('Retry a flaky JavaFX launch', 'Adds a retry loop so CI stops failing on a cold start. [CH1, commit:abc#2]');

  test('the PR text it matches drops brief refs and markers', () => {
    expect(joke).toBe('Retry a flaky JavaFX launch Adds a retry loop so CI stops failing on a cold start.');
  });

  test('three scenes the cast can play that fit the page, lead scenes first, distinct families, stable for a seed', () => {
    let leadFirst = 0;
    let full = 0;
    for (let i = 0; i < 60; i++) {
      const cast = isekaiCast(`offer ${i}`);
      const offer = isekaiMemeOffer(cast, joke);
      expect(offer).toEqual(isekaiMemeOffer(isekaiCast(`offer ${i}`), joke));
      // Three whenever the cast can perform three that fit the page; a few casts have fewer.
      expect(offer.length).toBeGreaterThan(0);
      expect(offer.length).toBeLessThanOrEqual(SCENE_OFFER_SIZE);
      if (offer.length === SCENE_OFFER_SIZE) full++;
      expect(new Set(offer.map((o) => o.family)).size).toBe(offer.length);
      const ids = new Set([cast.lead.archetype, ...cast.companions.map((m) => m.archetype), ...cast.contacts.map((m) => m.archetype)]);
      for (const o of offer) {
        for (const slot of o.cast) expect(ids.has(slot.archetype)).toBe(true);
        const others = o.cast.filter((x) => x.role !== 'lead');
        expect(others.filter((x) => x.role === 'companion').length).toBeLessThanOrEqual(cast.onPage.companions);
        expect(others.filter((x) => x.role === 'contact').length).toBeLessThanOrEqual(cast.onPage.contacts);
        expect(o.withLead).toBe(o.cast.some((x) => x.role === 'lead'));
      }
      // Lead scenes never follow a scene without the lead.
      const firstWithout = offer.findIndex((o) => !o.withLead);
      if (firstWithout >= 0) expect(offer.slice(firstWithout).every((o) => !o.withLead)).toBe(true);
      if (offer[0]!.withLead) leadFirst++;
    }
    expect(leadFirst).toBeGreaterThanOrEqual(55);
    expect(full).toBeGreaterThanOrEqual(55);
  });

  test('scenes recent comics used are not offered again', () => {
    const cast = isekaiCast('recent');
    const first = isekaiMemeOffer(cast, joke);
    const again = isekaiMemeOffer(cast, joke, first.map((o) => o.id));
    expect(again.some((o) => first.some((f) => f.id === o.id))).toBe(false);
  });

  test('withSceneOffers adds offers only to isekai genre options', () => {
    const options = genreOptions([], { pinned: 'anime-fantasy', seed: 's' });
    const [anime] = withSceneOffers(options, { title: 'Retry a flaky launch' });
    expect(anime!.sceneOffer).toHaveLength(3);
    const [space] = withSceneOffers(genreOptions([], { pinned: 'space-opera', seed: 's' }), { title: 'x' });
    expect(space!.sceneOffer).toBeUndefined();
    expect(space!.memeOffer?.length).toBeGreaterThan(0);
    expect(genreById('anime-fantasy')).toBeDefined();
  });
});

describe('the comic built on an offered scene', () => {
  const [option] = withSceneOffers(genreOptions([], { pinned: 'anime-fantasy', seed: 'check' }), { title: 'Retry a flaky launch' });
  const cast = option!.isekaiCast!;
  const scene = option!.sceneOffer![0]!;
  const players = [...new Set([cast.lead.archetype, ...scene.cast.filter((x) => !x.optional).map((x) => x.archetype)])];
  const good = (): ComicScript => {
    const s = pageScript() as ComicScript;
    const names = players.map((_, i) => `Name${i}`);
    return {
      ...s,
      genre: 'anime-fantasy',
      castPreset: cast.preset.id,
      place: 'a guild counter',
      meme: scene.id,
      characters: players.map((archetype, i) => ({ name: names[i]!, description: 'A plain decided design.', archetype })),
      lead: { persona: cast.lead.archetype, name: names[0]! },
      panels: s.panels.map((p) => ({ ...p, background: 'soft', characters: [{ name: names[0]!, position: 'left' }] })),
    } as ComicScript;
  };
  const memeErrors = (s: ComicScript) => errors(checkScript(s, { genreOptions: [option!] })).filter((p) => p.where === 'meme' || p.problem.includes('needs its'));

  test('an offered scene with its players on the page passes', () => {
    expect(memeErrors(good())).toEqual([]);
  });

  test('the scene is required and must be one offered', () => {
    expect(memeErrors({ ...good(), meme: undefined }).map((p) => p.where)).toEqual(['meme']);
    expect(memeErrors({ ...good(), meme: 'AF-M01-99' })[0]!.problem).toContain("wasn't offered");
  });

  test("the scene's players must be on the page", () => {
    const needed = scene.cast.filter((x) => !x.optional && x.archetype !== cast.lead.archetype);
    if (!needed.length) return;
    const s = good();
    const without = { ...s, characters: s.characters.filter((c) => c.archetype !== needed[0]!.archetype) };
    expect(memeErrors(without).some((p) => p.problem.includes(needed[0]!.archetype))).toBe(true);
  });

  test('the packet tells the author how to use the offer', () => {
    const files = comicPacketFiles({
      brief: 'b', description: 'd', genres: [option!], skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' }, checkCommand: 'tracetoon comic check',
    });
    expect(JSON.parse(files['context.json']!).genreOptions[0].sceneOffer).toHaveLength(3);
    expect(files['instructions.md']).toContain('`sceneOffer`');
    expect(files['instructions.md']).toContain('actual mechanism');
    expect(files['instructions.md']).toContain('Set `meme` to its id');
  });
});

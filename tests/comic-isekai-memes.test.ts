import { describe, expect, test } from 'bun:test';
import parity from './fixtures/isekai-meme-parity.json' with { type: 'json' };
import { ARCHETYPES } from '../src/comic/isekai/casting.ts';
import { ISEKAI_MEMES, matchContext, selectorMatches, suggest } from '../src/comic/isekai/memeMatch.ts';
import { FRANCHISE_NAMES } from '../src/comic/script.ts';

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

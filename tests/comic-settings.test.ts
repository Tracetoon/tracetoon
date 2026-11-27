import { describe, expect, test } from 'bun:test';
import { genreOptions } from '../src/comic/genres.ts';
import { STAPLE_TOPICS, tropeOffer, UNOFFERED_STAPLES } from '../src/comic/isekai/pitches.ts';
import { OFFICE_PLACE, SETTING_COOLDOWN, SETTINGS, settingPick } from '../src/comic/isekai/settings.ts';
import { STAPLES } from '../src/comic/isekai/pitches.ts';

describe('round 19: adventure settings, no office parody, PR-matched staples', () => {
  test('every setting gets used, none repeats within the cooldown, and each fits its own examples', () => {
    const recent: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const s = settingPick(`set${i}`, recent);
      expect(recent.slice(0, SETTING_COOLDOWN)).not.toContain(s.id);
      recent.unshift(s.id);
      seen.add(s.id);
    }
    expect(seen.size).toBe(SETTINGS.length);
    for (const s of SETTINGS) {
      for (const e of s.examples) expect(OFFICE_PLACE.test(e)).toBe(false);
      expect(s.examples.some((e) => s.words.test(`${e} in ${s.label}`))).toBe(true);
    }
  });

  test('the anime genre assigns a setting, resting the last comics\' settings from history', () => {
    const history = [{ setting: 'forest' }, { setting: 'dungeon' }, { setting: 'tavern' }];
    for (let i = 0; i < 40; i++) {
      const o = genreOptions([], { pinned: 'anime-fantasy', seed: `h${i}`, history })[0]!;
      expect(['forest', 'dungeon', 'tavern']).not.toContain(o.assignedSetting!.id);
    }
  });

  test('office-like places are caught', () => {
    for (const p of ["the guild hall's quest counter", 'the candlelit intake desk', 'the royal palace archive', "the adventurers' guild records office", 'the guild dispatch hall'])
      expect(OFFICE_PLACE.test(p)).toBe(true);
    for (const p of ['a mossy clearing in the forest', 'the boss door of a dungeon', 'around the campfire'])
      expect(OFFICE_PLACE.test(p)).toBe(false);
  });

  test('office staples are never offered; staples matching the PR are offered more often', () => {
    for (const id of Object.keys(STAPLE_TOPICS)) expect(STAPLES.map((s) => s.id)).toContain(id);
    const count = (prText: string, id: string) => Array.from({ length: 600 }, (_, i) => tropeOffer([], `pr${i}`, undefined, prText)).filter((o) => o.some((t) => t.id === id)).length;
    for (let i = 0; i < 300; i++) for (const t of tropeOffer([], `o${i}`)) expect(UNOFFERED_STAPLES.has(t.id)).toBe(false);
    expect(count('Add a benchmark score and faster performance report', 'absurdly-high-stats')).toBeGreaterThan(1.8 * count('', 'absurdly-high-stats'));
    expect(count('Fix login session token expiry', 'trapped-in-the-game')).toBeGreaterThan(1.8 * count('', 'trapped-in-the-game'));
  });
});

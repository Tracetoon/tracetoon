import { describe, expect, test } from 'bun:test';
import { genreOptions } from '../src/comic/genres.ts';
import { STAPLE_TOPICS, tropeOffer, UNOFFERED_STAPLES } from '../src/comic/isekai/pitches.ts';
import { OFFICE_PLACE, SETTING_COOLDOWN, SETTINGS, settingPick } from '../src/comic/isekai/settings.ts';
import { STAPLES } from '../src/comic/isekai/pitches.ts';
import { parseGenreFile } from '../src/comic/genreFile.ts';
import { errors, offerProblems } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';

describe('round 20: genre options settings: choose and tropes: off', () => {
  const file = `---\nid: anime-choose\nname: Anime choose\ncasting: isekai\nbrainstorm: off\nsettings: choose\ntropes: off\nsetting: an original fantasy world\narchetypes:\n  - isekai cast\nprops:\n  - status window\nstyles:\n  - anime-fantasy\n---\nNotes.\n`;
  test('three distinct fresh settings are offered, none recent, and no tropes', () => {
    const g = parseGenreFile(file).genre!;
    expect(g.settingChoice).toBe(true);
    expect(g.tropes).toBe(false);
    for (let i = 0; i < 30; i++) {
      const o = genreOptions([], { pinned: g.id, catalog: [g], seed: `c${i}`, history: [{ setting: 'forest' }, { setting: 'camp' }] })[0]!;
      expect(o.assignedSetting).toBeUndefined();
      expect(o.tropeOffer).toBeUndefined();
      const ids = o.settingOffer!.map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(['forest', 'camp']).not.toContain(id);
    }
  });
  test('the check accepts any offered setting and rejects others', () => {
    const g = parseGenreFile(file).genre!;
    const o = genreOptions([], { pinned: g.id, catalog: [g], seed: 'chk' })[0]!;
    const pick = o.settingOffer![2]!;
    const script = { genre: g.id, place: `${pick.examples[0]} in ${pick.label}`, setting: pick.id } as unknown as ComicScript;
    const where = (s: ComicScript) => errors(offerProblems(s, { genreOptions: [o] })).filter((p) => p.where === 'setting' || p.where === 'place');
    expect(where(script)).toEqual([]);
    expect(where({ ...script, setting: 'nowhere' }).map((p) => p.where)).toContain('setting');
  });
  test('settings: free assigns no setting but still rejects office places and office parody', () => {
    const g = parseGenreFile(file.replace('settings: choose', 'settings: free')).genre!;
    expect(g.settingFree).toBe(true);
    const o = genreOptions([], { pinned: g.id, catalog: [g], seed: 'free' })[0]!;
    expect(o.assignedSetting).toBeUndefined();
    expect(o.settingOffer).toBeUndefined();
    expect(o.adventureOnly).toBe(true);
    const problems = (s: object) => errors(offerProblems({ genre: g.id, panels: [], ...s } as unknown as ComicScript, { genreOptions: [o] })).filter((p) => !p.problem.includes('assigned layout'));
    expect(problems({ place: 'a moonlit shrine on a cliff' })).toEqual([]);
    expect(problems({ place: "the guild hall's quest counter" }).map((p) => p.where)).toContain('place');
    expect(problems({ place: 'a moonlit shrine', panels: [{ dialogue: [{ speaker: 'A', text: 'Fill out the paperwork.' }] }] }).map((p) => p.where)).toContain('panels');
  });
});

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

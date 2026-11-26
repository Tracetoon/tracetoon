import { describe, expect, test } from 'bun:test';
import { isekaiCast } from '../src/comic/isekai/casting.ts';
import { ISEKAI_MEMES } from '../src/comic/isekai/memeMatch.ts';
import premises from '../src/comic/isekai/scene-premises.json' with { type: 'json' };
import {
  ANIME_MEMES,
  castPitch,
  cooldownFrom,
  COOLDOWN,
  drawPitches,
  gagJudgePrompt,
  gagProblems,
  IDEAS,
  SHORTLIST,
  MEME_LIST_SIZE,
  memeChoices,
  pickGag,
  PITCHES,
  scoreProblems,
  recoveredAnchor,
  type Idea,
  type GagAnchor,
  type GagJudging,
  type GagsFile,
} from '../src/comic/isekai/pitches.ts';
import { comicSummary } from '../src/comic/composition.ts';
import { genreById, genreOptions, type GenreOption } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { checkScript, errors, FRANCHISE_NAMES } from '../src/comic/script.ts';
import type { ComicScript, ComicSummary } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const PREMISES = premises as Record<string, { label: string; premise: string }>;

describe('scenes: the research scenarios with their punchlines removed', () => {
  test('every scenario has a short premise and a neutral label, and none repeats its scenario', () => {
    expect(Object.keys(PREMISES).sort()).toEqual(ISEKAI_MEMES.map((m) => m.id).sort());
    for (const m of ISEKAI_MEMES) {
      const p = PREMISES[m.id]!;
      expect(p.premise.split(/\s+/).length).toBeLessThanOrEqual(45);
      expect(p.label.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(p.premise).not.toBe(m.meme);
      expect([m.id, FRANCHISE_NAMES.exec(`${p.label} ${p.premise}`)?.[0]]).toEqual([m.id, undefined]);
    }
  });
});

describe('the meme list', () => {
  test('lowercase unique ids, an allusion, a series and evidence each', () => {
    expect(new Set(ANIME_MEMES.map((m) => m.id)).size).toBe(ANIME_MEMES.length);
    for (const m of ANIME_MEMES) {
      expect(m.id).toMatch(/^[a-z0-9-]{1,80}$/);
      expect(m.allusion.length).toBeGreaterThan(10);
      expect(m.series.length).toBeGreaterThan(0);
      expect(m.evidence.url).toMatch(/^https:\/\//);
    }
  });

  test('memes used in the last 100 comics are spent; suiting memes come first; capped', () => {
    const cast = isekaiCast('memes');
    const pitches = drawPitches(cast, 'memes');
    const spent = ANIME_MEMES.slice(0, 5).map((m) => m.id);
    const list = memeChoices(pitches, 'memes', { scenes: [], characters: [], memes: spent });
    expect(list.some((m) => spent.includes(m.id))).toBe(false);
    expect(list.length).toBeLessThanOrEqual(MEME_LIST_SIZE);
    const players = new Set(pitches.flatMap((p) => p.players.map((x) => x.archetype)));
    const suits = list.map((m) => m.suits.some((a) => players.has(a)));
    expect(suits.indexOf(false) === -1 || !suits.slice(suits.indexOf(false)).includes(true)).toBe(true);
  });
});

describe('cooldowns per repo', () => {
  const comic = (n: number): ComicSummary => ({ pitch: `AF-M01-0${(n % 5) + 1}`, archetypes: [`P${String(n).padStart(2, '0')}`], meme: `meme-${n}` });
  test('scenarios for 10 comics, on-page characters for 3, memes for 100', () => {
    const history = Array.from({ length: 120 }, (_, n) => comic(n));
    const c = cooldownFrom(history);
    expect(c.scenes).toHaveLength(COOLDOWN.scenes);
    expect(c.characters).toEqual(['P00', 'P01', 'P02']);
    expect(c.memes).toHaveLength(COOLDOWN.memes);
    expect(c.memes).not.toContain('meme-100');
  });

  test('the summary records the pitch and the on-page archetypes', () => {
    const s = { ...(pageScript() as ComicScript), pitch: 'AF-M08-01', characters: [{ name: 'A', description: 'd', archetype: 'M08' }, { name: 'B', description: 'd', archetype: 'P19' }] } as ComicScript;
    expect(comicSummary(s)).toMatchObject({ pitch: 'AF-M08-01', archetypes: ['M08', 'P19'] });
  });
});

describe('pitches', () => {
  test('three, from different families, playable on one page, stable for a seed', () => {
    let full = 0;
    for (let i = 0; i < 40; i++) {
      const cast = isekaiCast(`pitch ${i}`);
      const pitches = drawPitches(cast, `pitch ${i}`);
      expect(pitches).toEqual(drawPitches(isekaiCast(`pitch ${i}`), `pitch ${i}`));
      // Three whenever the cast can play three scenarios on one page; a few casts can play only two.
      expect(pitches.length).toBeGreaterThanOrEqual(2);
      if (pitches.length === PITCHES) full++;
      expect(new Set(pitches.map((p) => p.family)).size).toBe(pitches.length);
      for (const p of pitches) {
        expect(p.premise).toBe(PREMISES[p.id]!.premise);
        const others = p.players.filter((x) => x.role !== 'lead');
        expect(others.filter((x) => x.role === 'companion').length).toBeLessThanOrEqual(cast.onPage.companions);
        expect(others.filter((x) => x.role === 'contact').length).toBeLessThanOrEqual(cast.onPage.contacts);
      }
    }
    expect(full).toBeGreaterThanOrEqual(36);
  });

  test('cooled-down scenarios and characters stay out; the lead may still play', () => {
    const cast = isekaiCast('cool');
    const first = drawPitches(cast, 'cool');
    const resting = cast.companions.map((m) => m.archetype);
    const next = drawPitches(cast, 'cool', { scenes: first.map((p) => p.id), characters: [...resting, cast.lead.archetype], memes: [] });
    expect(next.some((p) => first.some((f) => f.id === p.id))).toBe(false);
    for (const p of next) for (const x of p.players) if (x.role === 'companion') expect(resting).not.toContain(x.archetype);
  });

  test('random draws spread across the pool, and favour the lead', () => {
    const seen = new Set<string>();
    let withLead = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const pitches = drawPitches(isekaiCast(`spread ${i}`), `spread ${i}`);
      for (const p of pitches) {
        seen.add(p.id);
        total++;
        if (p.withLead) withLead++;
      }
    }
    // Each generated cast can play about a dozen scenarios, so 200 casts reach a third of the pool.
    expect(seen.size).toBeGreaterThan(150);
    expect(withLead / total).toBeGreaterThan(0.5);
  });

  test('a lead on cooldown gets another cast when one exists', () => {
    const base = genreOptions([], { pinned: 'anime-fantasy', seed: 'lead' })[0]!;
    const rested = genreOptions([], { pinned: 'anime-fantasy', seed: 'lead', cooldown: { scenes: [], characters: [base.isekaiCast!.lead.archetype], memes: [] } })[0]!;
    expect(rested.isekaiCast!.lead.archetype).not.toBe(base.isekaiCast!.lead.archetype);
    expect(rested.pitches).toHaveLength(PITCHES);
    expect(rested.memeList!.length).toBeGreaterThan(0);
  });

  test('castPitch refuses a scenario the cast cannot play', () => {
    const cast = isekaiCast('refuse');
    const ids = new Set([cast.lead, ...cast.companions, ...cast.contacts].map((m) => m.archetype));
    const solo = ISEKAI_MEMES.find((m) => m.cast.slots.length === 1 && m.cast.slots[0]!.selector.ids_any?.length === 1 && !ids.has(m.cast.slots[0]!.selector.ids_any[0]!))!;
    expect(castPitch(solo, cast)).toBeUndefined();
  });
});

describe('brainstorm v3: 20 ideas from the PR, a blind shortlist, the pick', () => {
  const option = genreOptions([], { pinned: 'anime-fantasy', seed: 'gags' })[0]!;
  const pitches = option.pitches!;
  const memes = option.memeList!;
  const PR = 'Adds a retry loop around the Maven launch so `mvn javafx:run` survives a cold start.';
  const anchor: GagAnchor = { change: 'The Maven launch now retries after a cold-start failure.', terms: ['javafx:run'] };
  const ideas: Idea[] = Array.from({ length: IDEAS }, (_, i) => ({
    id: `i${i + 1}`,
    idea: `Idea number ${i + 1}: a setup, then a payoff.`,
    shows: 'the gate plaque reads "javafx:run"',
    prLink: 'The retry loop.',
    ...(i === 2 ? { spark: pitches[0]!.id } : {}),
    ...(i === 3 ? { meme: memes[0]!.id, memeUse: 'shown as the allusion says' } : {}),
  }));
  const file: GagsFile = { anchor, ideas };

  test('the anchor first, exactly 20 distinct ideas, each lettering an anchor word; sparks and memes are optional', () => {
    expect(gagProblems(file, pitches, memes, PR)).toEqual([]);
    expect(gagProblems({ ideas }, pitches, memes, PR)[0]!.where).toBe('anchor');
    expect(gagProblems({ anchor: { ...anchor, terms: ['retryPolicy'] }, ideas }, pitches, memes, PR).some((p) => p.problem.includes("isn't in the PR"))).toBe(true);
    expect(gagProblems({ anchor, ideas: ideas.slice(1) }, pitches, memes, PR).some((p) => p.problem.includes(`exactly ${IDEAS}`))).toBe(true);
    expect(gagProblems({ anchor, ideas: [{ ...ideas[0]!, shows: 'a sign on the gate' }, ...ideas.slice(1)] }, pitches, memes, PR)[0]!.where).toBe('ideas[0].shows');
    expect(gagProblems({ anchor, ideas: [{ ...ideas[0]!, spark: 'AF-X99-01' }, ...ideas.slice(1)] }, pitches, memes, PR)[0]!.where).toBe('ideas[0].spark');
    expect(gagProblems({ anchor, ideas: [{ ...ideas[0]!, idea: ideas[1]!.idea }, ...ideas.slice(1)] }, pitches, memes, PR).some((p) => p.problem.includes('word for word'))).toBe(true);
  });

  test('the judge is blind: the PR and the ideas (with any borrowed situation), never the notes, anchor or shows', () => {
    const prompt = gagJudgePrompt({ description: PR, ideas: ideas.map((g) => ({ ...g, prLink: 'SECRET-NOTE', shows: 'SECRET-SHOWS' })), pitches, memes, out: 'judge.json' });
    expect(prompt).toContain(PR);
    expect(prompt).toContain(pitches[0]!.premise);
    expect(prompt).toContain(memes[0]!.name);
    expect(prompt).not.toContain('SECRET-NOTE');
    expect(prompt).not.toContain('SECRET-SHOWS');
    expect(prompt).not.toContain(anchor.change);
    expect(prompt).toContain(`Shortlist the ${SHORTLIST} best ideas`);
  });

  const judging = (recovered: (id: string) => string, shortlist = ['i2', 'i5', 'i1', 'i3', 'i4']): GagJudging => ({ ideas: ideas.map((g) => ({ id: g.id, recovered: recovered(g.id) })), shortlist });

  test('the judge must read every idea and shortlist five distinct ones', () => {
    expect(scoreProblems(judging(() => 'unclear'), ideas)).toEqual([]);
    expect(scoreProblems(judging(() => 'x', ['i1', 'i2']), ideas)[0]!.where).toBe('shortlist');
    expect(scoreProblems(judging(() => 'x', ['i1', 'i1', 'i2', 'i3', 'i4']), ideas)[0]!.where).toBe('shortlist');
    expect(scoreProblems({ ...judging(() => 'x'), ideas: [] }, ideas).some((p) => p.problem.includes('no reading'))).toBe(true);
  });

  test('a reading recovers the anchor by its words, or by most of the change', () => {
    expect(recoveredAnchor('It shows the javafx:run launch failing then retrying.', anchor)).toBe(true);
    expect(recoveredAnchor('The Maven launch retries after a cold start failure.', anchor)).toBe(true);
    expect(recoveredAnchor('Something about a fishing rig and patience.', anchor)).toBe(false);
  });

  test('the pick: the best shortlisted idea read correctly; then any idea read correctly; else the top of the shortlist, flagged', () => {
    const hit = pickGag(file, judging((id) => (id === 'i5' || id === 'i3' ? 'the javafx:run launch retries' : 'unclear')), pitches);
    expect(hit.idea.id).toBe('i5');
    expect(hit.rank).toBe(2);
    expect(hit.recovered).toBe(true);
    const offList = pickGag(file, judging((id) => (id === 'i17' ? 'javafx:run retries' : 'unclear')), pitches);
    expect(offList.idea.id).toBe('i17');
    expect(offList.rank).toBe(0);
    const none = pickGag(file, judging(() => 'unclear'), pitches);
    expect(none.idea.id).toBe('i2');
    expect(none.recovered).toBe(false);
    const sparked = pickGag(file, judging((id) => (id === 'i3' ? 'javafx:run' : 'unclear')), pitches);
    expect(sparked.pitch?.id).toBe(pitches[0]!.id);
  });

  const pick = pickGag(file, judging((id) => (id === 'i4' ? 'javafx:run retries' : 'unclear')), pitches);
  const picked = { ...option, pick };
  const script = (): ComicScript => {
    const s = pageScript() as ComicScript;
    return {
      ...s,
      genre: 'anime-fantasy',
      castPreset: option.isekaiCast!.preset.id,
      place: 'a guild counter',
      gag: pick.idea.id,
      ...(pick.idea.meme ? { meme: pick.idea.meme } : {}),
      anchor: { change: anchor.change, terms: ['javafx:run'], mapping: [{ visual: 'gate plaque', technical: 'the launch command' }] },
      characters: [{ name: 'N0', description: 'A plain decided design.', archetype: option.isekaiCast!.lead.archetype }],
      lead: { persona: option.isekaiCast!.lead.archetype, name: 'N0' },
      panels: s.panels.map((p) => ({ ...p, background: 'soft', characters: [{ name: 'N0', position: 'left' }] })),
    } as ComicScript;
  };
  const pickErrors = (s: ComicScript, o: GenreOption = picked) =>
    errors(checkScript(s, { genreOptions: [o] })).filter((p) => ['pitch', 'gag', 'meme', 'genre'].includes(p.where) || (p.where === 'anchor.terms' && p.problem.includes('picked')) || p.problem.includes('the pitch needs'));

  test('the comic is the picked idea: its id, meme and anchor words; no pitch when it borrowed none', () => {
    expect(pick.idea.id).toBe('i4');
    expect(pickErrors(script())).toEqual([]);
    expect(pickErrors({ ...script(), gag: 'i1' }).map((p) => p.where)).toContain('gag');
    expect(pickErrors({ ...script(), pitch: pitches[0]!.id }).map((p) => p.where)).toContain('pitch');
    expect(pickErrors({ ...script(), meme: undefined }).map((p) => p.where)).toContain('meme');
    expect(pickErrors({ ...script(), anchor: { ...script().anchor!, terms: ['launcher'] } }).some((p) => p.problem.includes("picked idea's anchor"))).toBe(true);
  });

  test('before a pick, writing the comic is an error: the genre brainstorms first', () => {
    expect(pickErrors(script(), option).map((p) => p.where)).toContain('genre');
  });

  test('the packet: name the PR first, then 20 ideas, then memes; then develop the pick with three concepts', () => {
    const files = (g = option) =>
      comicPacketFiles({
        brief: 'b', description: 'd', genres: [g], skillFiles: ['SKILL.md'],
        out: { comic: 'comic.json', design: 'comic-design.json', gags: 'comic-gags.json' }, checkCommand: 'tracetoon comic check', gagsCheckCommand: 'tracetoon comic gags --check',
      })['instructions.md']!;
    const brainstorm = files();
    expect(brainstorm).toContain('Name the PR first');
    expect(brainstorm).toContain(`Write ${IDEAS} ideas, fast`);
    expect(brainstorm).toContain('The `pitches` are sparks');
    expect(brainstorm).toContain('steps 2–4 wait');
    const scripting = files(picked);
    expect(scripting).toContain('already picked');
    expect(scripting).toContain('three ways to stage it');
  });

  test('brainstorm: off gives the cast and layout without pitches or memes', () => {
    const g = { ...genreById('anime-fantasy')!, brainstorm: false };
    const plain = genreOptions([], { pinned: 'anime-fantasy', seed: 'p', catalog: [g] })[0]!;
    expect(plain.isekaiCast).toBeDefined();
    expect(plain.assignedLayout).toBeDefined();
    expect(plain.pitches).toBeUndefined();
    expect(plain.memeList).toBeUndefined();
  });
});

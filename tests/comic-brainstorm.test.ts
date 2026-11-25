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
  GAGS_PER_PITCH,
  MEME_LIST_SIZE,
  memeChoices,
  pickGag,
  PITCHES,
  scoreProblems,
  type Gag,
  type GagScore,
} from '../src/comic/isekai/pitches.ts';
import { comicSummary } from '../src/comic/composition.ts';
import { genreOptions, type GenreOption } from '../src/comic/genres.ts';
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

describe('gags, the judge and the pick', () => {
  const option = genreOptions([], { pinned: 'anime-fantasy', seed: 'gags' })[0]!;
  const pitches = option.pitches!;
  const memes = option.memeList!;
  const gags: Gag[] = pitches.flatMap((p, i) =>
    Array.from({ length: GAGS_PER_PITCH }, (_, k) => ({ id: `g${i * GAGS_PER_PITCH + k + 1}`, pitch: p.id, gag: 'Setup, then a payoff.', prLink: 'The retry loop.' })),
  );
  gags[3] = { ...gags[3]!, meme: memes[0]!.id, memeUse: 'shown as the allusion says' };

  test('the gags file: two per pitch, known pitches and memes, a use for each meme', () => {
    expect(gagProblems({ gags }, pitches, memes)).toEqual([]);
    expect(gagProblems({ gags: gags.slice(1) }, pitches, memes).some((p) => p.problem.includes('has 1 gags'))).toBe(true);
    expect(gagProblems({ gags: [{ ...gags[0]!, pitch: 'AF-X99-01' }, ...gags.slice(1)] }, pitches, memes)[0]!.where).toBe('gags[0].pitch');
    expect(gagProblems({ gags: [{ ...gags[0]!, meme: 'nope', memeUse: 'x' }, ...gags.slice(1)] }, pitches, memes)[0]!.where).toBe('gags[0].meme');
    expect(gagProblems({ gags: [{ ...gags[0]!, meme: memes[0]!.id }, ...gags.slice(1)] }, pitches, memes)[0]!.where).toBe('gags[0].memeUse');
  });

  const scores: GagScore[] = gags.map((g, i) => ({ gag: g.id, aboutPr: 3, funny: 3, veteranAppeal: 3, visual: 3 + (i === 4 ? 2 : 0) }));
  test('the judge sees the PR, the situations, the gags and their memes, not the author', () => {
    const prompt = gagJudgePrompt({ description: 'Adds a retry loop.', gags, pitches, memes, out: 'scores.json' });
    expect(prompt).toContain('Adds a retry loop.');
    expect(prompt).toContain(pitches[0]!.premise);
    expect(prompt).toContain(memes[0]!.name);
    expect(prompt).toContain('"aboutPr": 1-5');
  });

  test('scores are 1–5 for every criterion and every gag', () => {
    expect(scoreProblems({ scores }, gags)).toEqual([]);
    expect(scoreProblems({ scores: scores.slice(1) }, gags).some((p) => p.problem.includes(`no score for ${gags[0]!.id}`))).toBe(true);
    expect(scoreProblems({ scores: [{ ...scores[0]!, funny: 7 }, ...scores.slice(1)] }, gags)[0]!.where).toBe('scores[0].funny');
  });

  test('the pick: the highest weighted total, about the PR and funny counting double; ties go to the first', () => {
    expect(pickGag(gags, scores, pitches).gag.id).toBe('g5');
    const prHeavy = scores.map((s) => (s.gag === 'g2' ? { ...s, aboutPr: 5 } : s));
    expect(pickGag(gags, prHeavy, pitches).gag.id).toBe('g2');
    const tied = gags.map((g) => ({ gag: g.id, aboutPr: 3, funny: 3, veteranAppeal: 3, visual: 3 }));
    expect(pickGag(gags, tied, pitches).gag.id).toBe('g1');
  });

  const pick = pickGag(gags, scores.map((s) => (s.gag === 'g4' ? { ...s, aboutPr: 5 } : s)), pitches);
  const picked = { ...option, pick };
  const players = [...new Set([option.isekaiCast!.lead.archetype, ...pick.pitch.players.filter((p) => !p.optional).map((p) => p.archetype)])];
  const script = (): ComicScript => {
    const s = pageScript() as ComicScript;
    return {
      ...s,
      genre: 'anime-fantasy',
      castPreset: option.isekaiCast!.preset.id,
      place: 'a guild counter',
      pitch: pick.pitch.id,
      gag: pick.gag.id,
      ...(pick.gag.meme ? { meme: pick.gag.meme } : {}),
      characters: players.map((archetype, i) => ({ name: `N${i}`, description: 'A plain decided design.', archetype })),
      lead: { persona: option.isekaiCast!.lead.archetype, name: 'N0' },
      panels: s.panels.map((p) => ({ ...p, background: 'soft', characters: [{ name: 'N0', position: 'left' }] })),
    } as ComicScript;
  };
  const pickErrors = (s: ComicScript, o: GenreOption = picked) => errors(checkScript(s, { genreOptions: [o] })).filter((p) => ['pitch', 'gag', 'meme', 'genre'].includes(p.where) || p.problem.includes('the pitch needs'));

  test('the comic is the picked gag: its pitch, its id, its meme and its players', () => {
    expect(pick.gag.id).toBe('g4');
    expect(pick.gag.meme).toBe(memes[0]!.id);
    expect(pickErrors(script())).toEqual([]);
    expect(pickErrors({ ...script(), gag: 'g1' }).map((p) => p.where)).toContain('gag');
    expect(pickErrors({ ...script(), pitch: 'AF-M01-01' }).map((p) => p.where)).toContain('pitch');
    expect(pickErrors({ ...script(), meme: undefined }).map((p) => p.where)).toContain('meme');
    const needed = pick.pitch.players.find((p) => !p.optional && p.archetype !== option.isekaiCast!.lead.archetype);
    if (needed) expect(pickErrors({ ...script(), characters: script().characters.filter((c) => c.archetype !== needed.archetype) }).length).toBeGreaterThan(0);
  });

  test('before a pick, writing the comic is an error: the genre brainstorms first', () => {
    expect(pickErrors(script(), option).map((p) => p.where)).toContain('genre');
  });

  test('the packet: brainstorm first, then the picked gag', () => {
    const files = (g = option) =>
      comicPacketFiles({
        brief: 'b', description: 'd', genres: [g], skillFiles: ['SKILL.md'],
        out: { comic: 'comic.json', design: 'comic-design.json', gags: 'comic-gags.json' }, checkCommand: 'tracetoon comic check', gagsCheckCommand: 'tracetoon comic gags --check',
      })['instructions.md']!;
    const brainstorm = files();
    expect(brainstorm).toContain('`pitches`');
    expect(brainstorm).toContain(`write ${GAGS_PER_PITCH} different gags`);
    expect(brainstorm).toContain('Only then read the genre\'s `memeList`');
    expect(brainstorm).toContain('steps 2–4 wait');
    const scripting = files(picked);
    expect(scripting).toContain('already picked');
    expect(scripting).not.toContain('steps 2–4 wait');
  });
});

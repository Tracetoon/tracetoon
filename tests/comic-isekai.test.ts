import { describe, expect, test } from 'bun:test';
import parity from './fixtures/isekai-parity.json' with { type: 'json' };
import {
  ARCHETYPES,
  generateCast,
  ISEKAI,
  makeMember,
  PRESET_WEIGHTS,
  RETIRED_ARCHETYPES,
  RETIRED_PRESETS,
  isekaiCast,
  presetPick,
  validateCast,
  type Cast,
  type Member,
  type Preset,
} from '../src/comic/isekai/casting.ts';
import { genreById, genreOptions } from '../src/comic/genres.ts';
import { comicPacketFiles } from '../src/comic/packet.ts';
import { pagePrompt, promptLint } from '../src/comic/providers.ts';
import { checkScript, errors } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const config = ISEKAI.generation_config;
const rules = (v: ReturnType<typeof validateCast>) => ({
  valid: v.mechanically_valid && v.passes_selected_editorial_policies,
  codes: [...v.hard_errors, ...v.policy_failures].map((x) => x.rule),
});

describe('the isekai guide, ported from generate_isekai_party.py', () => {
  test('every validator verdict matches the original on 240 generated and broken casts', () => {
    for (const c of parity.cases as { name: string; cast: Cast; expected: any }[]) {
      const v = validateCast(c.cast);
      expect({
        name: c.name,
        mechanically_valid: v.mechanically_valid,
        passes: v.passes_selected_editorial_policies,
        hard: v.hard_errors.map((x) => x.rule).sort(),
        policy: v.policy_failures.map((x) => x.rule).sort(),
        warnings: v.warnings.map((x) => x.rule).sort(),
        coverage: v.coverage,
      }).toEqual({
        name: c.name,
        mechanically_valid: c.expected.mechanically_valid,
        passes: c.expected.passes_selected_editorial_policies,
        hard: c.expected.hard,
        policy: c.expected.policy,
        warnings: c.expected.warnings,
        coverage: c.expected.coverage,
      });
    }
  });

  test("the guide's self-test: 1,200 casts across 12 presets, none invalid, wide variety", () => {
    const rosters = new Set<string>();
    for (const preset of Object.keys(ISEKAI.presets))
      for (let seed = 0; seed < 100; seed++) {
        const cast = generateCast(preset, String(seed));
        expect(rules(validateCast(cast)).valid).toBe(true);
        rosters.add(cast.members.map((m) => `${m.narrative_role}:${m.archetype_id}`).sort().join(','));
        expect(cast.world_contacts!.length).toBeGreaterThan(0);
      }
    expect(Object.keys(ISEKAI.presets)).toHaveLength(12);
    expect(rosters.size).toBeGreaterThan(900);
  });

  // The guide's domain fixtures (run_fixture_checks), with its policy.
  const policy: Partial<Preset> = { elf_cap: 1, mascot_cap: 2, novelty_budget: 1, allow_repeated_signature: false, required_functions: [], romance_mode: 'optional_adults_only' };
  const fixture = (ids: string[], edit?: (c: Cast) => void) => {
    const members = ids.map((id, n) => makeMember(id, n === 0 ? 'main' : 'party', config, ids[0]));
    const cast: Cast = { preset: 'fixture', members, overrides: {} };
    edit?.(cast);
    return rules(validateCast(cast, policy));
  };
  const fixtures: [string, string[], boolean, ((c: Cast) => void)?, string?][] = [
    ['Recognizable dysfunctional quartet', ['M02', 'P15', 'P17', 'P21'], true],
    ['Shield and offensive partner', ['M04', 'P09', 'P35'], true],
    ['Weapon guardian and willing child wielder', ['M13', 'P05'], true],
    ['Vending machine and strong carrier', ['M14', 'P40'], true],
    ['Cook with large and small familiars', ['M15', 'P37', 'P36'], true],
    ['Solo spider opening', ['M12'], true],
    ['Two unbundled protagonists', ['M01', 'M04', 'P09'], false, (c) => (c.members[1]!.narrative_role = 'main'), 'main_count'],
    ['Two elf profiles without exception', ['M01', 'P01', 'P04'], false, undefined, 'elf_cap'],
    ['Repeated identical elf profile', ['M01', 'P01', 'P01'], false, undefined, 'repeated_archetype'],
    ['Immobile machine without transport', ['M14', 'P16'], false, undefined, 'mobility'],
    ['Shield with no attacking companion', ['M04', 'P15', 'P16'], false, undefined, 'attack_dependency'],
    ['Romance assigned to a child', ['M06', 'P29'], false, (c) => (c.members[0]!.romance_enabled = true), 'romance_age'],
    ['Romance assigned to a familiar', ['M15', 'P37'], false, (c) => Object.assign(c.members[1]!, { present_age_group: 'adult', romance_enabled: true }), 'romance_relationship'],
    ['Unrelated added time mechanism', ['M01', 'P16'], false, (c) => (c.members[1]!.mechanism_tags = ['time_loop']), 'novelty_budget'],
    ['Documented two-elf travel exception', ['M01', 'P01', 'P04'], true, (c) => (c.overrides = { elf_cap: { justification: 'Deliberate elf siblings traveling together with different professions.' }, repeated_signature: { justification: 'One precise archer and one formal shield-bearing bodyguard have contrasting tasks and speech.' } })],
    ['Fixed-location vending service', ['M14', 'P16'], true, (c) => (c.mobility_solution = 'The story stays in one village shop; no mobile expedition occurs.')],
    ['Weapon with no willing wielder', ['M13', 'P16'], false, undefined, 'wielder'],
    ['Explicitly bundled co-leads with shared premise', ['M01', 'M04', 'P09'], true, (c) => {
      c.members[1]!.narrative_role = 'main';
      c.protagonist_bundle = { id: 'linked_summoned_duo', members: ['M01', 'M04'] };
      c.overrides = { novelty_budget: { justification: 'The two declared protagonists share one summoning incident and one magic system rather than introducing unrelated genre mechanisms.' } };
    }],
  ];
  test("all 18 of the guide's domain fixtures pass, as in the original", () => {
    const expected = new Map((parity.fixtures as { name: string; passed: boolean }[]).map((f) => [f.name, f.passed]));
    expect(fixtures).toHaveLength(18);
    for (const [name, ids, valid, edit, rule] of fixtures) {
      const r = fixture(ids, edit);
      expect({ name, valid: r.valid }).toEqual({ name, valid });
      if (rule) expect(r.codes).toContain(rule);
      expect(expected.get(name)).toBe(true);
    }
  });

  test("the guide's 10 source-reference cast shapes validate, as in the original", () => {
    const refPolicy = (p: Partial<Preset> = {}): Partial<Preset> => ({ elf_cap: 1, mascot_cap: 1, novelty_budget: 1, allow_repeated_signature: false, required_functions: [], romance_mode: 'off', ...p });
    const shape = (ids: string[], edit?: (m: Member[], c: Cast) => Partial<Preset> | void) => {
      const members = ids.map((id, n) => makeMember(id, n === 0 ? 'main' : 'party', config, ids[0]));
      members.forEach((m, n) => Object.assign(m, { character_id: `ref_${ids.join('')}_${n}`, romance_enabled: false }));
      const cast: Cast = { preset: 'source_reference', members, overrides: {} };
      const p = edit?.(members, cast) ?? {};
      return rules(validateCast(cast, refPolicy(p))).valid;
    };
    const results = [
      shape(['M02', 'P15', 'P17', 'P21'], (m) => { m[0]!.present_age_group = 'teen'; m[2]!.present_age_group = 'teen'; }),
      shape(['M30', 'P21', 'P32', 'P33']),
      shape(['M12']),
      shape(['M13', 'P05', 'P37'], (m) => { m[2]!.relationship_to_main = 'familiar'; }),
      shape(['M14', 'P40'], (_m, c) => { c.world_contacts = [makeMember('N08', 'world', config)]; }),
      shape(['M15', 'P37', 'P36'], () => ({ mascot_cap: 3 })),
      shape(['M27', 'P16', 'P43', 'P31', 'P39'], (m) => {
        for (const n of [0, 1, 2]) m[n]!.species = 'elf';
        for (const n of [1, 2, 3]) m[n]!.relationship_to_main = 'family';
        Object.assign(m[4]!, { species: 'artificial_intelligence', relationship_to_main: 'information_assistant' });
        return { elf_cap: null };
      }),
      shape(['M19', 'P44', 'P44', 'P25', 'P16'], (m, c) => {
        for (const x of m) x.present_age_group = 'teen';
        c.overrides = { repeated_archetype: { justification: 'Geordo and Alan are explicitly linked twins with different temperaments and activities.' }, repeated_signature: { justification: 'The court ensemble intentionally contains twin princes with distinct social dynamics.' } };
      }),
      shape(['M11', 'P26', 'P28', 'P30', 'P20', 'P05', 'P43'], (m) => {
        for (const n of [5, 6]) Object.assign(m[n]!, { species: 'dark_elf', relationship_to_main: 'retainer', present_age_group: 'nonhuman' });
        return { elf_cap: null };
      }),
      shape(['M24', 'P28'], (m, c) => {
        Object.assign(m[1]!, { species: 'human', relationship_to_main: 'adjutant', romance_enabled: false });
        c.world_contacts = [makeMember('N30', 'world', config), makeMember('N30', 'world', config)];
      }),
    ];
    expect(results).toEqual((parity.references as { passed: boolean }[]).map((r) => r.passed));
    expect(results.every(Boolean)).toBe(true);
  });
});

describe('anime fantasy cast from the guide', () => {
  test('the genre is rebuilt on the guide: no old roster, leads, diverse cast, memes or style mix', () => {
    const g = genreById('anime-fantasy')!;
    expect(g.isekai).toBe(true);
    for (const k of ['cast', 'diverseCast', 'leads', 'memes', 'styleMix'] as const) expect(g[k]).toBeUndefined();
    expect(g.setting).not.toMatch(/guild halls?, taverns/);
  });

  test('presets are weighted toward the recognizable ones and skip the last two comics', () => {
    expect(PRESET_WEIGHTS.standard_adventure).toBe(2);
    expect(PRESET_WEIGHTS.court_otome).toBe(1);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) counts.set(presetPick(`s${i}`), (counts.get(presetPick(`s${i}`)) ?? 0) + 1);
    expect(counts.size).toBe(11);
    expect(counts.get('standard_adventure')! / counts.get('court_otome')!).toBeGreaterThan(1.5);
    for (let i = 0; i < 200; i++) expect(['survival', 'court_otome']).not.toContain(presetPick(`r${i}`, ['survival', 'court_otome']));
  });

  test('the spider, the vending machine and the military prodigy are never cast (round 19)', () => {
    expect([...RETIRED_PRESETS]).toEqual(['military']);
    expect(PRESET_WEIGHTS.military).toBeUndefined();
    const ids = Array.from({ length: 300 }, (_, i) => isekaiCast(`ret${i}`)).flatMap((c) => [c.lead, ...c.companions, ...c.contacts].map((m) => m.archetype));
    for (const id of RETIRED_ARCHETYPES) expect(ids).not.toContain(id);
    expect(ids).toContain('M13');
    expect(ids).toContain('M03');
  });

  test('each comic gets a fresh cast with the recipes the author needs', () => {
    const casts = Array.from({ length: 40 }, (_, i) => genreOptions([], { pinned: 'anime-fantasy', seed: `c${i}` })[0]!.isekaiCast!);
    for (const c of casts) {
      expect(ARCHETYPES[c.lead.archetype]!.category).toBe('main');
      expect(c.companions.length).toBeGreaterThan(0);
      expect(c.lead.look.length).toBeGreaterThan(20);
      expect(c.onPage).toEqual({ companions: 2, contacts: 1 });
    }
    expect(new Set(casts.map((c) => c.lead.archetype)).size).toBeGreaterThan(15);
  });

  const option = genreOptions([], { pinned: 'anime-fantasy', seed: 'check-1' })[0]!;
  const cast = option.isekaiCast!;
  const good = (): ComicScript => {
    const s = pageScript() as ComicScript;
    return {
      ...s,
      genre: 'anime-fantasy',
      castPreset: cast.preset.id,
      place: `${option.assignedSetting!.examples[0]} in ${option.assignedSetting!.label}`,
      setting: option.assignedSetting!.id,
      characters: [
        { name: 'Ari', description: 'A lean young man with short black hair, a plain gray travel coat and a cheap phone in one hand.', archetype: cast.lead.archetype },
        { name: 'Vell', description: 'A tall woman in green forest leathers with a long silver braid and a measuring cord.', archetype: cast.companions[0]!.archetype },
      ],
      lead: { persona: cast.lead.archetype, name: 'Ari' },
      panels: s.panels.map((p, i) => ({ ...p, background: i === 0 ? 'detailed' : 'soft', characters: [{ name: 'Ari', position: 'left' }, { name: 'Vell', position: 'right' }] })),
    } as ComicScript;
  };

  test('the check holds the page to the generated cast, one decided design each, one place and a background per panel', () => {
    const opts = { genreOptions: [option] };
    const isekaiErrors = (s: ComicScript) => errors(checkScript(s, opts)).filter((p) => /^(characters|lead|place|castPreset|panels\[\d+\]\.background)/.test(p.where));
    expect(isekaiErrors(good())).toEqual([]);
    const s = good();
    expect(isekaiErrors({ ...s, characters: [...s.characters, { name: 'X', description: 'd', archetype: 'P99' }] }).map((p) => p.where)).toContain('characters[2].archetype');
    expect(isekaiErrors({ ...s, characters: [{ ...s.characters[0]!, description: 'Wears a school jacket or a travel coat.' }, s.characters[1]!] }).map((p) => p.where)).toContain('characters[0].description');
    expect(isekaiErrors({ ...s, place: 'a tavern or a dungeon' }).map((p) => p.where)).toContain('place');
    expect(isekaiErrors({ ...s, place: undefined }).map((p) => p.where)).toContain('place');
    expect(isekaiErrors({ ...s, panels: s.panels.map((p) => ({ ...p, background: undefined })) }).some((p) => p.where.endsWith('.background'))).toBe(true);
    expect(isekaiErrors({ ...s, castPreset: 'nope' }).map((p) => p.where)).toContain('castPreset');
    // Round 19: the host assigns the setting; office places and office parody fail.
    expect(isekaiErrors({ ...s, place: "the guild hall's quest counter" }).map((p) => p.problem).join(' ')).toContain('office-like');
    expect(errors(checkScript({ ...s, setting: 'nowhere' }, opts)).map((p) => p.where)).toContain('setting');
    const memo = { ...s, panels: s.panels.map((p, i) => (i === 0 ? { ...p, dialogue: [{ speaker: 'Ari', text: 'Fill out the paperwork first.' }] } : p)) } as ComicScript;
    expect(errors(checkScript(memo, opts)).some((p) => p.problem.includes('office parody'))).toBe(true);
    const anchored = { ...s, anchor: { change: 'The preview path becomes a link.', terms: ['preview.html'], mapping: [{ visual: 'the glowing sign', technical: 'the preview link' }] } } as ComicScript;
    const flatEnd = { ...anchored, panels: s.panels.map((p, i) => (i === s.panels.length - 1 ? { ...p, dialogue: [{ speaker: 'Ari', text: 'Well, that happened.' }] } : p)) } as ComicScript;
    // Round 20: a warning, not an error (as an error it was met with re-lettered signs).
    const payoff = (x: ComicScript) => checkScript(x, opts).filter((p) => p.problem.includes('is in the last panel'));
    expect(payoff(flatEnd).map((p) => p.severity)).toEqual(['warning']);
    expect(payoff(anchored)).toEqual([]);
    const companions = cast.companions.slice(0, 3).map((m, i) => ({ name: `C${i}`, description: 'A plain decided design.', archetype: m.archetype }));
    if (companions.length === 3)
      expect(isekaiErrors({ ...s, characters: [s.characters[0]!, ...companions] }).some((p) => p.problem.includes('at most 2 companions'))).toBe(true);
  });

  test('the image prompt carries decisions only: one place, decided backgrounds, no lists, no space examples', () => {
    const prompt = pagePrompt(good());
    expect(prompt).toContain(`Setting: ${option.assignedSetting!.examples[0]} in ${option.assignedSetting!.label}.`);
    expect(prompt).not.toContain('guild halls, taverns');
    expect(prompt).not.toContain('cantina');
    expect(prompt).not.toContain('dialogue panels and detailed scenery only');
    expect(prompt).toContain('Detailed background.');
    expect(prompt).toContain('Soft, out-of-focus background behind the characters.');
    expect(prompt).not.toMatch(/\.\./);
    expect(prompt).not.toContain('looking ');
    expect(promptLint(prompt)).toEqual([]);
    expect(promptLint('Characters: Ari: wears a school jacket or a travel coat.')).toHaveLength(1);
    expect(promptLint('Panel 1: "this or that" said aloud.')).toHaveLength(0);
  });

  test('the packet hands the author the cast and the decisions to make', () => {
    const files = comicPacketFiles({
      brief: 'b', description: 'd', genres: [option], skillFiles: ['SKILL.md'],
      out: { comic: 'comic.json', design: 'comic-design.json' }, checkCommand: 'tracetoon comic check',
    });
    expect(JSON.parse(files['context.json']!).genreOptions[0].isekaiCast.lead.archetype).toBe(cast.lead.archetype);
    expect(files['instructions.md']).toContain('ONE final design');
    expect(files['instructions.md']).toContain('`place`');
  });
});

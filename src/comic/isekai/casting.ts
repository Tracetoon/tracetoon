/**
 * Isekai cast generation, ported from the research guide's generator
 * (generate_isekai_party.py, with isekai_archetype_system.json). The rules,
 * caps and dependencies are the guide's; only the random source differs
 * (seeded from sha256, like Tracetoon's other host picks), so samples differ
 * from the Python script but every verdict matches (tests/fixtures/isekai-parity.json).
 *
 * The guide's caveats hold here too: editorial caps are adjustable design
 * policies, not measured genre frequencies, and a valid cast says nothing
 * about audience recognition or comic quality.
 */
import { presentationOf } from './presentation.ts';
import { createHash } from 'node:crypto';
import system from './system.json' with { type: 'json' };

export interface Archetype {
  id: string;
  title: string;
  category: 'main' | 'party' | 'world';
  recurrence: string;
  genre_lanes: string[];
  core: string;
  look: string;
  engine: string;
  kit: string;
  variants: string[];
  default_species: string;
  functions: string[];
  signature_family: string;
  premise_cost: number;
  age_presentation: string;
  romance_default: string;
  pairs_well: string[];
  avoid_redundancy: string;
  preset_eligibility: string[];
  [key: string]: unknown;
}

export interface Preset {
  label: string;
  scope: string;
  main_pool: string[];
  party_pool: string[];
  support_count?: number | [number, number] | { min: number; max: number };
  minmax?: [number, number];
  fixed_support_by_main?: Record<string, string[]>;
  required_functions?: string[];
  elf_cap?: number | null;
  mascot_cap?: number | null;
  novelty_budget?: number | null;
  allow_repeated_signature?: boolean;
  romance_mode?: string;
  sustain_plan?: string;
  world_pool?: string[];
}

export interface Member {
  archetype_id: string;
  narrative_role: 'main' | 'party' | 'world' | string;
  title?: string;
  present_age_group: string;
  romance_enabled: boolean;
  relationship_to_main: string;
  species: string;
  mechanism_tags: string[];
  contribution?: string;
  functions?: string[];
  character_id?: string;
  willing_wielder?: boolean;
  chosen_variant?: string;
  mobility_solution?: string;
  [key: string]: unknown;
}

export interface Cast {
  preset: string;
  seed?: number | string;
  scope?: string;
  members: Member[];
  world_contacts?: Member[];
  overrides?: Record<string, { justification?: string } | unknown>;
  sustain_plan?: string;
  generation_note?: string;
  phase_note?: string;
  protagonist_bundle?: { id?: string; members?: string[] };
  mobility_solution?: string;
  editorial_review_notes?: string[];
  validation?: CastValidation;
  sampling_attempts?: number;
}

export interface CastValidation {
  mechanically_valid: boolean;
  passes_selected_editorial_policies: boolean;
  hard_errors: { rule: string; message: string }[];
  policy_failures: { rule: string; message: string }[];
  warnings: { rule: string; message: string; accepted_exception: string }[];
  recognized_by_audience: 'not_measured';
  coverage: { broad_functions: string[]; missing_functions: string[]; elf_count: number; familiar_focal_units: number; premise_mechanisms: string[] };
}

type Config = Record<string, any>;
export interface IsekaiSystem {
  archetypes: Archetype[];
  presets: Record<string, Preset>;
  generation_config: Config;
  visual_dimensions: Record<string, unknown>;
  [key: string]: unknown;
}

export const ISEKAI = system as unknown as IsekaiSystem;
export const ARCHETYPES: Record<string, Archetype> = Object.fromEntries(ISEKAI.archetypes.map((a) => [a.id, a]));

const AGE_GROUPS = new Set(['adult', 'child', 'teen', 'nonhuman']);
const NONHUMAN_DEFAULTS = new Set(['M10', 'M11', 'M12', 'M13', 'M14', 'M25', 'P34', 'P36', 'P37', 'P38', 'P39']);
/** World-contact pools by preset, as in the guide's generator. */
export const WORLD_POOLS: Record<string, string[]> = {
  standard_adventure: ['N01', 'N02', 'N04', 'N05', 'N07', 'N09', 'N18', 'N19', 'N20', 'N22'],
  disaster_comedy: ['N01', 'N04', 'N05', 'N07', 'N18', 'N20', 'N30'],
  harem_adventure: ['N01', 'N04', 'N05', 'N09', 'N10', 'N12', 'N16', 'N19'],
  survival: ['N04', 'N05', 'N09', 'N19', 'N20', 'N22'],
  cozy_familiars: ['N01', 'N04', 'N05', 'N07', 'N09', 'N20', 'N22', 'N28'],
  object_duo: ['N01', 'N05', 'N07', 'N08', 'N09', 'N19', 'N22', 'N30'],
  court_otome: ['N09', 'N10', 'N11', 'N12', 'N13', 'N14', 'N16', 'N30'],
  monster_court: ['N09', 'N10', 'N12', 'N19', 'N20', 'N24', 'N25', 'N26', 'N30'],
  professional: ['N01', 'N05', 'N07', 'N08', 'N09', 'N10', 'N15', 'N16', 'N19', 'N22', 'N30'],
  military: ['N19', 'N30'],
  cozy_household: ['N04', 'N05', 'N07', 'N09', 'N10', 'N16', 'N20', 'N22'],
  guild_ensemble: ['N01', 'N02', 'N04', 'N05', 'N07', 'N09', 'N19', 'N30'],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const asTags = (value: unknown): string[] => (!value ? [] : typeof value === 'string' ? [value] : [...(value as string[])]);
const counter = (xs: string[]) => xs.reduce<Map<string, number>>((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

export function supportBounds(preset: Preset): [number, number] {
  const bounds = preset.support_count ?? preset.minmax ?? [3, 4];
  if (typeof bounds === 'number') return [bounds, bounds];
  if (!Array.isArray(bounds)) return [bounds.min, bounds.max];
  return [bounds[0], bounds[1]];
}

function mechanisms(member: Member, config: Config): Set<string> {
  return new Set([...asTags(config.mechanism_by_id?.[member.archetype_id]), ...asTags(member.mechanism_tags)]);
}

function ageFor(id: string, config: Config): string {
  const explicit = config.age_group_by_id?.[id];
  if (explicit) return explicit;
  if ((config.child_default_ids ?? []).includes(id) || id === 'N06' || id === 'N21') return 'child';
  if ((config.teen_default_ids ?? []).includes(id)) return 'teen';
  if (NONHUMAN_DEFAULTS.has(id) || (config.nonhuman_default_ids ?? []).includes(id)) return 'nonhuman';
  return 'adult';
}

export function makeMember(id: string, role: string, config: Config, mainId?: string, presetName?: string): Member {
  const archetype = ARCHETYPES[id]!;
  const familiar = (config.familiar_ids ?? []).includes(id);
  let relation = role === 'main' ? 'self' : role === 'world' ? 'local_contact' : familiar ? 'familiar' : 'companion';
  relation = config.relationship_by_id?.[id] ?? relation;
  const result: Member = {
    archetype_id: id,
    narrative_role: role,
    title: archetype.title,
    present_age_group: ageFor(id, config),
    romance_enabled: false,
    relationship_to_main: relation,
    species: archetype.default_species ?? 'unspecified',
    mechanism_tags: asTags(config.mechanism_by_id?.[id]),
    contribution: archetype.core ?? '',
    functions: archetype.functions ?? [],
  };
  if (mainId === 'M13' && id === 'P05') {
    Object.assign(result, { present_age_group: 'child', relationship_to_main: 'ward', willing_wielder: true });
    result.chosen_variant = 'Nonromantic child adventurer in a guardian and willing wielder partnership.';
  }
  if (presetName === 'military' && role === 'party') {
    Object.assign(result, { species: 'human', relationship_to_main: 'colleague' });
    result.chosen_variant = 'Original military-setting version of the role; uniform and equipment follow this worlds military premise.';
  }
  const overrides = config.fixed_instance_overrides_by_main?.[mainId ?? '']?.[id] ?? {};
  Object.assign(result, clone(overrides));
  return result;
}

function isElf(member: Member, archetype: Archetype, config: Config): boolean {
  const species = String(member.species ?? archetype.default_species ?? '').toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return (config.elf_species ?? []).includes(species) || species.includes('elf') || species.includes('elven');
}

/** Hard errors, editorial policy failures and accepted exceptions, as the guide's validate_cast. */
export function validateCast(cast: Cast, presetOverride?: Partial<Preset>): CastValidation {
  const config = ISEKAI.generation_config;
  const presetName = cast.preset;
  let preset = (presetOverride ?? ISEKAI.presets[presetName]) as Partial<Preset> | undefined;
  const hard: { rule: string; message: string }[] = [];
  const policy: { rule: string; message: string }[] = [];
  const warnings: { rule: string; message: string; accepted_exception: string }[] = [];
  const fail = (rule: string, message: string) => hard.push({ rule, message });
  const editorial = (rule: string, message: string) => {
    const override = (cast.overrides ?? {})[rule] as { justification?: unknown } | undefined;
    const reason = override && typeof override === 'object' ? override.justification : '';
    if (typeof reason === 'string' && reason.trim().length >= 12) warnings.push({ rule, message, accepted_exception: reason });
    else policy.push({ rule, message });
  };
  if (!preset) {
    fail('preset', `Unknown preset: ${presetName}`);
    preset = {};
  }
  let members = cast.members;
  if (!Array.isArray(members) || !members.length) {
    fail('members', 'A cast requires a nonempty members list.');
    members = [];
  }
  let contacts = cast.world_contacts ?? [];
  if (!Array.isArray(contacts)) {
    fail('world_contacts', 'world_contacts must be a list when supplied.');
    contacts = [];
  }
  const known: Member[] = [];
  [...members, ...contacts].forEach((member, number) => {
    const aid = member.archetype_id;
    if (!ARCHETYPES[aid]) {
      fail('archetype', `Unknown archetype ${JSON.stringify(aid)} in member ${number + 1}.`);
      return;
    }
    known.push(member);
    const role = member.narrative_role;
    if (!['main', 'party', 'world'].includes(role)) fail('role', `${aid} needs main, party, or world as narrative_role.`);
    if (!AGE_GROUPS.has(member.present_age_group)) fail('age', `${aid} needs an explicit adult, child, teen, or nonhuman age group.`);
    if (typeof member.romance_enabled !== 'boolean') fail('romance_flag', `${aid} needs an explicit boolean romance_enabled.`);
    if (role === 'party' && !member.relationship_to_main) fail('relationship', `${aid} needs a declared reason or relationship for joining.`);
    if (member.romance_enabled) {
      const relation = member.relationship_to_main;
      if (member.present_age_group !== 'adult') fail('romance_age', `${aid} is not an explicitly adult romantic design.`);
      if (['familiar', 'ward', 'child', 'sibling', 'parent'].includes(relation) || (config.familiar_ids ?? []).includes(aid))
        fail('romance_relationship', `${aid} has a nonromantic familial or familiar relationship.`);
      if ((config.nonromantic_ids ?? []).includes(aid)) fail('romance_catalog', `${aid} uses a nonromantic catalog default.`);
      if (preset!.romance_mode === 'off') fail('romance_mode', `Romance is off in preset ${presetName}.`);
    }
  });

  const active = known.filter((m) => m.narrative_role === 'main' || m.narrative_role === 'party');
  const leads = active.filter((m) => m.narrative_role === 'main');
  const supporters = active.filter((m) => m.narrative_role === 'party');
  const bundle = cast.protagonist_bundle ?? {};
  const bundleValid = !!bundle.id && JSON.stringify([...(bundle.members ?? [])].sort()) === JSON.stringify(leads.map((m) => m.archetype_id).sort());
  if (leads.length !== 1 && !(leads.length > 1 && bundleValid)) fail('main_count', 'Use exactly one protagonist, or an explicitly named bundle listing every co-lead.');
  for (const lead of leads)
    if (preset.main_pool?.length && !preset.main_pool.includes(lead.archetype_id))
      editorial('main_pool', `${lead.archetype_id} is outside this presets normal protagonist pool.`);
  for (const member of supporters)
    if (preset.party_pool?.length && !preset.party_pool.includes(member.archetype_id))
      editorial('party_pool', `${member.archetype_id} is outside this presets normal support pool.`);
  if (preset.support_count !== undefined && preset.support_count !== null) {
    const [low, high] = supportBounds(preset as Preset);
    if (!(low <= supporters.length && supporters.length <= high))
      editorial('support_count', `Expected ${low} to ${high} supporting focal characters; found ${supporters.length}.`);
  }

  const characterIds = active.flatMap((m) => (m.character_id ? [m.character_id] : []));
  if (characterIds.length !== new Set(characterIds).size) fail('character_identity', 'Two active entries reuse the same character_id; forms belong to one individual.');
  const counts = counter(active.map((m) => m.archetype_id));
  if ([...counts.values()].some((v) => v > 1))
    editorial('repeated_archetype', 'The same archetype appears more than once; describe the intended twin, rival, or cohort distinction.');
  const signatures = counter(active.map((m) => ARCHETYPES[m.archetype_id]!.signature_family ?? m.archetype_id));
  const repeated = [...signatures.entries()].filter(([, v]) => v > 1).map(([k]) => k);
  if (repeated.length && !preset.allow_repeated_signature)
    editorial('repeated_signature', `Repeated dramatic families need an intentional contrast: ${repeated.join(', ')}.`);

  const elfCount = active.filter((m) => isElf(m, ARCHETYPES[m.archetype_id]!, config)).length;
  if (preset.elf_cap !== undefined && preset.elf_cap !== null && elfCount > preset.elf_cap)
    editorial('elf_cap', `This preset prefers at most ${preset.elf_cap} elf-coded members; found ${elfCount}. This includes half and dark elves.`);
  const mascotCount = active.filter((m) => (config.mascot_ids ?? []).includes(m.archetype_id) || m.relationship_to_main === 'familiar').length;
  if (preset.mascot_cap !== undefined && preset.mascot_cap !== null && mascotCount > preset.mascot_cap)
    editorial('mascot_cap', `This preset prefers at most ${preset.mascot_cap} familiar focal units; found ${mascotCount}.`);
  const premiseTags = [...new Set(active.flatMap((m) => [...mechanisms(m, config)]))].sort();
  if (preset.novelty_budget !== undefined && preset.novelty_budget !== null && premiseTags.length > preset.novelty_budget)
    editorial('novelty_budget', `Found ${premiseTags.length} separate premise mechanisms against budget ${preset.novelty_budget}: ${premiseTags.join(', ')}.`);

  const functions = new Set(active.flatMap((m) => ARCHETYPES[m.archetype_id]!.functions ?? []));
  const missingFunctions = [...new Set(preset.required_functions ?? [])].filter((f) => !functions.has(f)).sort();
  if (missingFunctions.length) editorial('function_coverage', `Missing broad functions for this preset: ${missingFunctions.join(', ')}. Support does not imply healing.`);
  for (const lead of leads) {
    const aid = lead.archetype_id;
    if (aid === 'M14' && !supporters.some((m) => m.archetype_id === 'P40') && !lead.mobility_solution && !cast.mobility_solution)
      fail('mobility', 'The vending-machine expedition needs P40 or an explicit mobility_solution, including a stated fixed-location format.');
    if (aid === 'M13' && !supporters.some((m) => m.willing_wielder))
      fail('wielder', 'The weapon-guardian premise needs a willing wielder. Teacher-like telekinesis means this is a relationship dependency, not immobility.');
    if (aid === 'M04' && !supporters.some((m) => (ARCHETYPES[m.archetype_id]!.functions ?? []).includes('damage')))
      fail('attack_dependency', 'A defense-limited shield protagonist needs another active member with an attacking role.');
    for (const required of preset.fixed_support_by_main?.[aid] ?? [])
      if (!supporters.some((m) => m.archetype_id === required))
        editorial('fixed_support', `This preset pairs ${aid} with ${required}; a deliberate alternative needs a justified override.`);
  }
  return {
    mechanically_valid: !hard.length,
    passes_selected_editorial_policies: !policy.length,
    hard_errors: hard,
    policy_failures: policy,
    warnings,
    recognized_by_audience: 'not_measured',
    coverage: { broad_functions: [...functions].sort(), missing_functions: missingFunctions, elf_count: elfCount, familiar_focal_units: mascotCount, premise_mechanisms: premiseTags },
  };
}

/** A few visible creative risks; these are not hard rejections (the guide's editorial_notes). */
export function editorialNotes(cast: Cast): string[] {
  const ids = new Set(cast.members.map((m) => m.archetype_id));
  const has = (xs: string[]) => xs.filter((x) => ids.has(x)).length;
  const notes = ['Choose individual names, voices, goals, and relationships before using this sketch in a comic.'];
  if (has(['P15', 'P16', 'P33']) > 1) notes.push('Two healing-oriented templates overlap: distinguish emergency treatment, purification, supplies, payment, or personal goals.');
  if (has(['P02', 'P23', 'P24', 'P44']) > 1) notes.push('Several court-linked figures need distinct status, obligations, and reasons to travel together.');
  if (cast.members.filter((m) => (ARCHETYPES[m.archetype_id]!.functions ?? []).includes('frontline')).length >= 3)
    notes.push('Several members can stand in front: separate protection, pursuit, reach, and intimidation instead of giving them the same fight beat.');
  if (cast.members.some((m) => m.narrative_role === 'main' && ['child', 'teen'].includes(m.present_age_group)))
    notes.push('The young lead needs explicit friend, mentor, guardian, or colleague relationships; adult romance is not inferred from nearby companions.');
  if (cast.preset === 'harem_adventure') notes.push('This is an adult romance candidate pool. Select explicit consenting adult romantic bonds; the sketch currently enables none.');
  return notes;
}

/** A seeded random source (sha256 → 32-bit state, mulberry32). */
export function seededRandom(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const choice = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const randint = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function sample<T>(rng: () => number, xs: readonly T[], k: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out;
}

/** A seeded cast sketch for a preset, as the guide's generate_cast (up to 500 attempts). */
export function generateCast(presetName: string, seed: string): Cast {
  const preset = ISEKAI.presets[presetName];
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);
  const config = ISEKAI.generation_config;
  const rng = seededRandom(`isekai\0${presetName}\0${seed}`);
  const [low, high] = supportBounds(preset);
  for (let attempt = 0; attempt < 500; attempt++) {
    const mainId = choice(rng, preset.main_pool);
    const selected = [...(preset.fixed_support_by_main?.[mainId] ?? [])];
    const count = Math.max(randint(rng, low, high), selected.length);
    const remaining = preset.party_pool.filter((id) => !selected.includes(id));
    if (remaining.length < count - selected.length) continue;
    selected.push(...sample(rng, remaining, count - selected.length));
    const members = [makeMember(mainId, 'main', config, mainId, presetName), ...selected.map((id) => makeMember(id, 'party', config, mainId, presetName))];
    members.forEach((m, i) => (m.character_id = `character_${i + 1}`));
    const cast: Cast = {
      preset: presetName,
      seed,
      scope: preset.scope,
      members,
      overrides: {},
      sustain_plan: preset.sustain_plan ?? 'Specify recovery and resupply.',
      generation_note: 'Original cast sketch from archetype recipes; not a canonical series roster. Romance remains off until explicit adult relationships are designed.',
    };
    if (presetName === 'survival') cast.phase_note = 'An expedition after recruitment, or a longitudinal ally network; a spider-like solo opening can precede this cast.';
    if (presetName === 'military') cast.phase_note = 'Supporting templates use original native military variants, not transplanted canonical source characters.';
    const result = validateCast(cast);
    if (!result.mechanically_valid || !result.passes_selected_editorial_policies) continue;
    const candidateWorld = preset.world_pool ?? config.world_pool_by_preset?.[presetName] ?? WORLD_POOLS[presetName] ?? config.world_pool ?? [];
    const worldPool = (candidateWorld as string[]).filter((id) => ARCHETYPES[id]);
    cast.world_contacts = sample(rng, worldPool, Math.min(2, worldPool.length)).map((id) => makeMember(id, 'world', config, mainId, presetName));
    cast.editorial_review_notes = editorialNotes(cast);
    cast.validation = validateCast(cast);
    cast.sampling_attempts = attempt + 1;
    return cast;
  }
  throw new Error(`Could not satisfy preset ${presetName} after 500 attempts; inspect its pools, dependencies, and editorial caps.`);
}

/** Preset weights: the most recognizable presets twice as likely (owner's decision, round 12). */
export const PRESET_WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.keys(ISEKAI.presets).map((p) => [p, ['standard_adventure', 'disaster_comedy', 'guild_ensemble', 'survival'].includes(p) ? 2 : 1]),
);

/** The preset for a comic, by seeded weight, skipping presets the last two comics used. */
export function presetPick(seed: string, recent: string[] = []): string {
  const skip = new Set(recent.slice(0, 2));
  const entries = Object.entries(PRESET_WEIGHTS).filter(([p]) => !skip.has(p));
  const pool = entries.length ? entries : Object.entries(PRESET_WEIGHTS);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let x = seededRandom(`isekai-preset\0${seed}`)() * total;
  for (const [p, w] of pool) if ((x -= w) < 0) return p;
  return pool[pool.length - 1]![0];
}

/** One cast member as the author sees it: the generated slot plus the guide's full recipe. */
export interface PacketMember {
  archetype: string;
  title: string;
  role: 'lead' | 'companion' | 'contact';
  ageGroup: string;
  relationship: string;
  /** The guide's species label, left out when an audited presentation describes the body instead. */
  species?: string;
  functions: string[];
  core: string;
  look: string;
  engine: string;
  kit: string;
  variants: string[];
  note?: string;
  /** How the archetype is drawn, checked against its sources (presentation.ts): base body and visible traits. */
  presentation?: string;
  /** What the image must not add to this character. */
  notOnPage?: string[];
}

/** The generated cast in a comic packet. */
export interface IsekaiPacketCast {
  preset: { id: string; label: string; scope: string; sustainPlan: string; requiredFunctions: string[] };
  lead: PacketMember;
  companions: PacketMember[];
  contacts: PacketMember[];
  notes: string[];
  recognitionRule: string;
  /** On the page: the lead, at most this many companions and contacts. */
  onPage: { companions: number; contacts: number };
}

export const PAGE_COMPANIONS = 2;
export const PAGE_CONTACTS = 1;

function packetMember(m: Member, role: PacketMember['role']): PacketMember {
  const a = ARCHETYPES[m.archetype_id]!;
  const shown = presentationOf(a.id);
  return {
    archetype: a.id,
    title: a.title,
    role,
    ageGroup: m.present_age_group,
    relationship: m.relationship_to_main,
    species: m.species,
    functions: a.functions ?? [],
    core: a.core,
    look: a.look,
    engine: a.engine,
    kit: a.kit,
    variants: a.variants ?? [],
    ...(m.chosen_variant ? { note: m.chosen_variant } : {}),
    // An audited body replaces the species label: the author describes traits, never "lizardfolk".
    ...(shown ? { species: undefined, look: shown.look ?? a.look, presentation: shown.presentation, notOnPage: shown.notOnPage, ...(shown.core ? { core: shown.core } : {}), ...(shown.variants ? { variants: shown.variants } : {}) } : {}),
  };
}

/** A comic's cast: a weighted preset (skipping the last two comics' presets) and a generated, validated cast. */
export function isekaiCast(seed: string, recentPresets: string[] = []): IsekaiPacketCast {
  const presetId = presetPick(seed, recentPresets);
  const cast = generateCast(presetId, seed);
  const preset = ISEKAI.presets[presetId]!;
  return {
    preset: { id: presetId, label: preset.label, scope: preset.scope, sustainPlan: cast.sustain_plan ?? '', requiredFunctions: preset.required_functions ?? [] },
    lead: packetMember(cast.members[0]!, 'lead'),
    companions: cast.members.slice(1).map((m) => packetMember(m, 'companion')),
    contacts: (cast.world_contacts ?? []).map((m) => packetMember(m, 'contact')),
    notes: [...(cast.editorial_review_notes ?? []), ...(cast.phase_note ? [cast.phase_note] : [])],
    recognitionRule: String((ISEKAI.visual_dimensions as { recognition_rule?: string }).recognition_rule ?? ''),
    onPage: { companions: PAGE_COMPANIONS, contacts: PAGE_CONTACTS },
  };
}

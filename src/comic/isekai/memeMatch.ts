/**
 * Cast-compatible anime gag scenarios, ported from the research agent's
 * match_memes.py (with anime-fantasy.json, 530 scenes, five per archetype).
 * Required cast slots are filled with distinct members of the comic's
 * generated cast, declared conditions are checked, and compatible scenes are
 * ranked by relevance to the PR (80%) and the research's evidence-based
 * priority (20%), with a penalty for repeating a gag family. The results match
 * the Python matcher exactly (tests/fixtures/isekai-meme-parity.json).
 *
 * The research's caveats hold: the scenes are newly authored adaptations, the
 * priority score is an editorial evidence weight, not a popularity statistic,
 * and lexical relevance is a retrieval filter, not proof of fit.
 */
import { ARCHETYPES, ISEKAI } from './casting.ts';
import pool from './memes.json' with { type: 'json' };

export interface Selector {
  ids_any?: string[];
  categories_any?: string[];
  functions_any?: string[];
  species_any?: string[];
  signature_families_any?: string[];
  exclude_ids?: string[];
}

export interface Slot {
  slot: string;
  description: string;
  selector: Selector;
  optional?: boolean;
}

export interface IsekaiMeme {
  id: string;
  title: string;
  meme: string;
  use: string;
  focus_archetype_id: string;
  focus_category?: string;
  family: string;
  tier: number;
  cast: { slots: Slot[]; min_characters: number; max_characters: number; distinct_instances?: boolean };
  conditions: { world_rules_all: string[]; relationships_all: { a: string; b: string; any_of: string[] }[]; adults_only_slots: string[] };
  priority: { score: number };
  joke_topics?: string[];
  keywords?: string[];
  props?: string[];
  setting?: string;
  gag_mechanism?: string;
  pattern_kind?: string;
}

export const ISEKAI_MEMES = pool as unknown as IsekaiMeme[];

const TOPIC_TERMS: Record<string, string[]> = {
  overengineering: ['overengineer', 'overkill', 'complex', 'elaborate', 'simple'],
  scope_creep: ['scope', 'refactor', 'rewrite', 'small change', 'one more'],
  performance: ['performance', 'speed', 'benchmark', 'throughput', 'fast'],
  latency: ['latency', 'slow', 'wait', 'timeout', 'loading', 'delay'],
  dependencies: ['dependency', 'dependencies', 'library', 'package', 'import', 'upstream'],
  compatibility: ['compatib', 'legacy', 'breaking', 'version', 'integration'],
  testing: ['test', 'qa', 'coverage', 'flaky', 'assert', 'fixture'],
  deployment: ['deploy', 'release', 'production', 'shipping', 'launch', 'rollout'],
  rollback: ['rollback', 'revert', 'retry', 'reset', 'undo', 'restore'],
  monitoring: ['monitor', 'metric', 'dashboard', 'alert', 'observab', 'logging'],
  security: ['security', 'vulnerab', 'attack', 'exploit', 'secret', 'firewall'],
  permissions: ['permission', 'access', 'privilege', 'admin', 'auth', 'read only'],
  documentation: ['document', 'readme', 'manual', 'comment', 'guide', 'undocumented'],
  onboarding: ['onboard', 'new hire', 'newcomer', 'orientation', 'first day'],
  communication: ['communicat', 'misunderstand', 'message', 'meeting', 'silence'],
  leadership: ['leader', 'manager', 'boss', 'strategy', 'delegat', 'command'],
  budget: ['budget', 'cost', 'bill', 'invoice', 'expense', 'money', 'cloud spend'],
  negotiation: ['negotiat', 'bargain', 'price', 'deal', 'contract', 'vendor'],
  maintenance: ['maintain', 'maintenance', 'repair', 'patch', 'cleanup', 'chore'],
  automation: ['automat', 'script', 'bot', 'pipeline', 'cron', 'workflow'],
  data_quality: ['data', 'invalid', 'corrupt', 'schema', 'duplicate', 'format'],
  resource_limits: ['resource', 'resources', 'memory', 'capacity', 'limit', 'quota', 'exhaust', 'out of', 'allocation'],
  support: ['support', 'help desk', 'customer', 'ticket', 'service'],
  incident_response: ['incident', 'outage', 'on call', 'oncall', 'pager', 'hotfix', 'emergency'],
  hidden_complexity: ['hidden', 'surprise', 'unexpected', 'actually', 'rabbit hole'],
  requirements: ['requirement', 'spec', 'acceptance', 'request', 'stakeholder'],
  recognition: ['credit', 'praise', 'recognition', 'reward', 'promotion', 'impostor'],
  incentives: ['incentive', 'bonus', 'target', 'kpi', 'gamif', 'reward'],
  scheduling: ['schedule', 'deadline', 'calendar', 'time zone', 'appointment'],
  priorities: ['priorit', 'backlog', 'urgent', 'important', 'distraction', 'triage'],
  technical_debt: ['debt', 'shortcut', 'temporary', 'workaround', 'later', 'todo'],
  ui_ux: ['interface', 'ui', 'ux', 'button', 'menu', 'usability', 'dialog'],
  naming: ['name', 'naming', 'label', 'title', 'variable', 'rename'],
  teamwork: ['team', 'collaborat', 'pair', 'handoff', 'cooperat', 'partner'],
  competition: ['compet', 'rival', 'contest', 'rank', 'winner', 'leaderboard'],
  change_management: ['migration', 'upgrade', 'adoption', 'resist', 'change', 'tradition'],
  misdiagnosis: ['diagnos', 'blame', 'root cause', 'symptom', 'wrong fix'],
  lock_in: ['lock in', 'locked', 'unsubscribe', 'exit', 'cancel', 'irreversible'],
  learning: ['learn', 'train', 'tutorial', 'lesson', 'mentor', 'student'],
  burnout: ['burnout', 'overtime', 'tired', 'sleep', 'exhaust', 'vacation'],
  logistics: ['transport', 'carry', 'route', 'shipment', 'supply', 'delivery', 'stairs'],
};
const STOP = new Set(
  'a an and are as at be been but by can do does for from had has have he her him his how i if in is it its just like me my of on one or our she so that the their them then there these they this to too us was we were what when which who why will with you your'.split(' '),
);
const ADULT_LABELS = new Set(['adult', 'adult_by_design', 'mature_adult', 'adult_or_elder', 'elder', 'adult_presenting']);
const ADULT_PREFIXES = ['adult original', 'adult;', 'adult woman', 'adult worker', 'adult present-day', 'explicit adult', 'elderly adult'];

export interface Actor {
  instance_id: string;
  archetype_id: string;
  name: string;
  category: string;
  functions: string[];
  species?: string;
  signature_family?: string;
  present_age_group: string;
}

export interface MatchContext {
  characters: Actor[];
  world_rules: string[];
  mechanisms: Record<string, string>;
  relationships: { a: string; b: string; type: string }[];
}

const tokenise = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((x) => !STOP.has(x) && x.length > 1);

/** A cast (archetype ids, repeats are distinct instances) as the matcher's context. */
export function matchContext(ids: string[], worldRules: string[] = []): MatchContext {
  const config = ISEKAI.generation_config as Record<string, any>;
  const characters: Actor[] = [];
  const mechanisms: Record<string, string> = {};
  ids.forEach((id, i) => {
    const base = ARCHETYPES[id];
    if (!base) throw new Error(`Unknown archetype_id: ${id}`);
    const instance = `${id}_${i + 1}`;
    let age: string | undefined = config.age_group_by_id?.[id];
    if (age === undefined) {
      const label = String(base.age_presentation ?? '').toLowerCase();
      age = ADULT_LABELS.has(label) || ADULT_PREFIXES.some((p) => label.startsWith(p)) ? 'adult' : 'unknown';
    }
    characters.push({ instance_id: instance, archetype_id: id, name: base.title, category: base.category, functions: base.functions ?? [], species: base.default_species, signature_family: base.signature_family, present_age_group: age });
    const mechanism = config.mechanism_by_id?.[id];
    if (mechanism) mechanisms[instance] = mechanism;
  });
  return { characters, world_rules: [...new Set(worldRules)].sort(), mechanisms, relationships: [] };
}

export function selectorMatches(selector: Selector, actor: Actor): boolean {
  const positive = Object.keys(selector).filter((k) => k !== 'exclude_ids');
  if (!positive.length) return false;
  if (selector.exclude_ids?.includes(actor.archetype_id)) return false;
  if (selector.ids_any && !selector.ids_any.includes(actor.archetype_id)) return false;
  if (selector.categories_any && !selector.categories_any.includes(actor.category)) return false;
  if (selector.species_any && !selector.species_any.includes(actor.species ?? '')) return false;
  if (selector.signature_families_any && !selector.signature_families_any.includes(actor.signature_family ?? '')) return false;
  if (selector.functions_any && !selector.functions_any.some((f) => actor.functions.includes(f))) return false;
  return true;
}

type Assignment = Record<string, Actor>;

function conditionStatus(entry: IsekaiMeme, assignment: Assignment, context: MatchContext): ['eligible' | 'conditional' | 'blocked', string[]] {
  const rules = entry.conditions ?? { world_rules_all: [], relationships_all: [], adults_only_slots: [] };
  const unresolved: string[] = [];
  const available = new Set(context.world_rules);
  const performer = assignment.performer;
  if (performer && context.mechanisms[performer.instance_id]) available.add(context.mechanisms[performer.instance_id]!);
  for (const rule of rules.world_rules_all ?? []) if (!available.has(rule)) unresolved.push(`Enable or confirm world rule: ${rule}`);
  for (const slot of rules.adults_only_slots ?? []) {
    const age = assignment[slot]?.present_age_group ?? 'unknown';
    if (age === 'child' || age === 'teen') return ['blocked', [`Romantic scene does not fit the present age of slot: ${slot}`]];
    if (age !== 'adult') unresolved.push(`Confirm adult presentation for slot: ${slot}`);
  }
  for (const relation of rules.relationships_all ?? []) {
    const a = assignment[relation.a]!.instance_id;
    const b = assignment[relation.b]!.instance_id;
    const observed = new Set(context.relationships.filter((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)).map((r) => r.type));
    if (relation.any_of.some((t) => observed.has(t))) continue;
    if (observed.size) return ['blocked', [`Declared relationship does not match: ${a} / ${b}`]];
    unresolved.push(`Confirm relationship ${a} / ${b}: ${relation.any_of.join(', ')}`);
  }
  return [unresolved.length ? 'conditional' : 'eligible', unresolved];
}

export type MatchResult =
  | { status: 'eligible' | 'conditional'; assignment: Assignment; unresolved_conditions: string[] }
  | { status: 'missing_cast' | 'blocked'; missing_slots: string[]; reason?: string[] };

export function matchEntry(entry: IsekaiMeme, context: MatchContext): MatchResult {
  const required = entry.cast.slots.filter((s) => !s.optional);
  const choices = Object.fromEntries(required.map((s) => [s.slot, context.characters.filter((a) => selectorMatches(s.selector, a))])) as Record<string, Actor[]>;
  const empty = required.filter((s) => !choices[s.slot]!.length).map((s) => s.slot);
  if (empty.length) return { status: 'missing_cast', missing_slots: empty };
  const ordered = [...required].sort((x, y) => choices[x.slot]!.length - choices[y.slot]!.length);
  let bestConditional: { status: 'conditional'; assignment: Assignment; unresolved_conditions: string[] } | undefined;
  let eligible: { status: 'eligible'; assignment: Assignment; unresolved_conditions: string[] } | undefined;
  const rejected: string[] = [];
  const walk = (index: number, assignment: Assignment, used: Set<string>) => {
    if (eligible) return;
    if (index === ordered.length) {
      const [status, notes] = conditionStatus(entry, assignment, context);
      if (status === 'blocked') {
        rejected.push(...notes);
        return;
      }
      if (status === 'eligible') eligible = { status, assignment: { ...assignment }, unresolved_conditions: notes };
      else if (!bestConditional || notes.length < bestConditional.unresolved_conditions.length)
        bestConditional = { status: 'conditional', assignment: { ...assignment }, unresolved_conditions: notes };
      return;
    }
    const key = ordered[index]!.slot;
    for (const actor of choices[key]!) {
      if (used.has(actor.instance_id)) continue;
      assignment[key] = actor;
      walk(index + 1, assignment, new Set([...used, actor.instance_id]));
      delete assignment[key];
      if (eligible) return;
    }
  };
  walk(0, {}, new Set());
  const result = eligible ?? bestConditional;
  if (!result)
    return { status: rejected.length ? 'blocked' : 'missing_cast', missing_slots: [], reason: rejected.length ? [...new Set(rejected)].sort() : ['Required roles cannot be assigned to distinct character instances.'] };
  const used = new Set(Object.values(result.assignment).map((a) => a.instance_id));
  for (const slot of entry.cast.slots) {
    if (!slot.optional) continue;
    for (const actor of context.characters)
      if (!used.has(actor.instance_id) && selectorMatches(slot.selector, actor)) {
        result.assignment[slot.slot] = actor;
        used.add(actor.instance_id);
        break;
      }
  }
  return result;
}

/** Python's round(x, 2), for scores compared and reported like the original. */
const round2 = (x: number) => Number(x.toFixed(2));

export function relevance(entry: IsekaiMeme, query: string): [number, string[], string[]] {
  const queryWords = new Set(tokenise(query));
  if (!queryWords.size) return [0, [], []];
  const clean = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
  const topics = Object.entries(TOPIC_TERMS)
    .filter(([, terms]) => terms.some((term) => (term.includes(' ') ? clean.includes(term) : [...queryWords].some((w) => w.startsWith(term)))))
    .map(([t]) => t);
  const matchedTopics = [...new Set(topics)].filter((t) => (entry.joke_topics ?? []).includes(t)).sort();
  const fields: [string, number][] = [
    [(entry.keywords ?? []).join(' '), 2.0],
    [entry.title, 1.4],
    [entry.use, 1.8],
    [entry.meme, 0.7],
  ];
  let weighted = 0;
  const hitWords = new Set<string>();
  for (const [text, weight] of fields) {
    const words = new Set(tokenise(text));
    const hits = [...queryWords].filter((q) => words.has(q) || (q.length >= 5 && [...words].some((w) => w.startsWith(q) || (q.startsWith(w) && w.length >= 5))));
    weighted += hits.length * weight;
    for (const h of hits) hitWords.add(h);
  }
  const lexical = Math.min(45, (45 * weighted) / Math.max(1, queryWords.size * 2.2));
  const topical = Math.min(55, 32 * matchedTopics.length);
  return [round2(lexical + topical), matchedTopics, [...hitWords].sort()];
}

export interface Suggestion {
  id: string;
  title: string;
  meme: string;
  use: string;
  family: string;
  status: 'eligible' | 'conditional';
  score: number;
  relevance_score: number;
  matched_topics: string[];
  assignment: Record<string, string>;
  unresolved_conditions: string[];
}

/** Rank compatible scenes, up to `limit` honest matches (the original's suggest(), fixed-cast mode). */
export function suggest(
  context: MatchContext,
  joke = '',
  opts: { limit?: number; includeConditional?: boolean; minRelevance?: number; pool?: IsekaiMeme[] } = {},
): { suggestions: Suggestion[]; counts: Record<string, number>; filtered: number } {
  const limit = opts.limit ?? 3;
  const minRelevance = opts.minRelevance ?? 8;
  const hasQuery = joke.trim().length > 0;
  let filtered = 0;
  const counts: Record<string, number> = { eligible: 0, conditional: 0, missing_cast: 0, blocked: 0 };
  const candidates: { entry: IsekaiMeme; match: Extract<MatchResult, { status: 'eligible' | 'conditional' }>; relevance: number; topics: string[]; base: number }[] = [];
  for (const entry of opts.pool ?? ISEKAI_MEMES) {
    const match = matchEntry(entry, context);
    counts[match.status]!++;
    if (match.status !== 'eligible' && !(opts.includeConditional && match.status === 'conditional')) continue;
    const [topical, topics] = relevance(entry, joke);
    if (hasQuery && topical < minRelevance) {
      filtered++;
      continue;
    }
    const priority = Number(entry.priority?.score ?? 0);
    let base = hasQuery ? 0.8 * topical + 0.2 * priority : priority;
    if (match.status === 'conditional') base -= 12;
    candidates.push({ entry, match: match as Extract<MatchResult, { status: 'eligible' | 'conditional' }>, relevance: topical, topics, base });
  }
  const chosen: Suggestion[] = [];
  const familyCount: Record<string, number> = {};
  while (candidates.length && chosen.length < limit) {
    candidates.sort((x, y) => {
      const dx = -(x.base - 14 * (familyCount[x.entry.family] ?? 0));
      const dy = -(y.base - 14 * (familyCount[y.entry.family] ?? 0));
      if (dx !== dy) return dx - dy;
      if (x.relevance !== y.relevance) return y.relevance - x.relevance;
      return x.entry.id < y.entry.id ? -1 : x.entry.id > y.entry.id ? 1 : 0;
    });
    const c = candidates.shift()!;
    const penalty = 14 * (familyCount[c.entry.family] ?? 0);
    familyCount[c.entry.family] = (familyCount[c.entry.family] ?? 0) + 1;
    chosen.push({
      id: c.entry.id,
      title: c.entry.title,
      meme: c.entry.meme,
      use: c.entry.use,
      family: c.entry.family,
      status: c.match.status,
      score: round2(c.base - penalty),
      relevance_score: c.relevance,
      matched_topics: c.topics,
      assignment: Object.fromEntries(Object.entries(c.match.assignment).map(([slot, actor]) => [slot, actor.archetype_id])),
      unresolved_conditions: c.match.unresolved_conditions,
    });
  }
  return { suggestions: chosen, counts, filtered };
}

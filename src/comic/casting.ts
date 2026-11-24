/**
 * Casting by rotation. A single comic can't show that a repo's comics include
 * all kinds of people; a run of comics can. Asking every author to "be
 * diverse" made each comic answer with the same one character, so instead
 * the host occasionally offers one concrete, optional suggestion, drawn by
 * seed from a broad pool. Most comics get none and simply cast what the
 * story and genre call for.
 */
import { createHash } from 'node:crypto';

/** Roughly one comic in five gets a suggestion: noticeable across a run, not the point of every comic. */
export const CAST_HINT_RATE = 1 / 5;

/**
 * People a comic might include. Backgrounds, ages, bodies and LGBTQ+ people
 * all appear, each a person rather than a role, so the author fits them into
 * whatever role the story needs.
 */
export const CAST_POOL: readonly string[] = [
  'a Mexican-American woman in her fifties',
  'a young Korean man',
  'a broad-shouldered Samoan man',
  'a South Asian teenage girl',
  'a Nigerian man in his sixties',
  'a Vietnamese grandmother',
  'a Lebanese woman',
  'a Navajo man',
  'a Brazilian woman with freckles',
  'a Japanese man who uses a wheelchair',
  'a Filipino teenager',
  'a Puerto Rican man with a big beard',
  'a Scottish woman in her seventies',
  'a Ghanaian woman',
  'a Chinese-Canadian man',
  'a Māori woman',
  'an Ethiopian man',
  'a Peruvian woman',
  'a lanky Polish man',
  'an Indian man in his forties',
  'a Hawaiian woman',
  'a deaf crew member who signs',
  'an Iranian woman with a cane',
  'a Jamaican man with grey dreadlocks',
  'a gay man who mentions his husband',
  'two women who are married to each other',
  'a man who mentions his boyfriend',
  'an older lesbian couple',
  'a trans woman',
  'a trans man',
  'a nonbinary person who uses they/them',
  'a nonbinary teenager',
  'a bisexual pilot who mentions their partner',
];

const hash = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);

/**
 * One optional casting suggestion for this comic, or undefined (most of the
 * time). Stable for a seed, so a rerun of the same run sees the same hint.
 */
export function castHint(seed: string, rate = CAST_HINT_RATE): string | undefined {
  if (hash(`hint\0${seed}`) / 0x1_0000_0000 >= rate) return undefined;
  return CAST_POOL[hash(`pick\0${seed}`) % CAST_POOL.length];
}

const STOP = new Set(['a', 'an', 'the', 'and', 'with', 'in', 'of', 'her', 'his', 'their', 'who']);
const words = (look: string) =>
  new Set(
    look
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((w) => w && !STOP.has(w)),
  );

/** Word overlap (Jaccard) of two lead looks; 1 means the same few words. */
export function lookSimilarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Looks this close count as the same character design. */
export const SAME_LOOK = 0.5;

/**
 * Cast offers. A genre with a persona roster (`cast`) doesn't show the author
 * the whole roster: shown every choice, an author makes the same best pick
 * every time. The host picks five personas per comic by seed instead, and the
 * author casts from those five. Most offers are a party (three main-cast roles,
 * a nemesis and a side character); some are side characters only.
 */
export const MAIN_ROLES = ['hero', 'mage', 'warrior', 'healer', 'scout'] as const;
export const CAST_ROLES = [...MAIN_ROLES, 'nemesis', 'side'] as const;
export type CastRole = (typeof CAST_ROLES)[number];

export interface CastPersona {
  /** Short stable id the script records in `personas`. */
  id: string;
  role: CastRole;
  /** The persona in a few words. */
  name: string;
  /** Quirk, look and the kind of joke they carry. */
  details: string;
}

export interface CastOffer {
  /** `party`: main cast with a nemesis and a side character; `side-only`: no main cast. */
  kind: 'party' | 'side-only';
  personas: CastPersona[];
}

/** Roughly one offer in five is side characters only. */
export const SIDE_ONLY_RATE = 1 / 5;
export const OFFER_SIZE = 5;
export const MAX_CAST_ENTRY = 220;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');

/** Parses a roster entry, `role: name — details`; undefined when malformed. */
export function parseCastEntry(entry: string): CastPersona | undefined {
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s+[—–-]{1,2}\s+(.+?)\s*$/.exec(entry);
  if (!m) return undefined;
  const role = m[1] as CastRole;
  if (!CAST_ROLES.includes(role)) return undefined;
  const name = m[2]!.trim();
  return { id: slug(name.replace(/^(an?|the)\s+/i, '')), role, name, details: m[3]!.trim() };
}

const shuffled = <T extends { id: string }>(items: readonly T[], seed: string, tag: string): T[] =>
  [...items].sort((a, b) => hash(`${tag}\0${seed}\0${a.id}`) - hash(`${tag}\0${seed}\0${b.id}`));

/**
 * Five personas for this comic, stable for a seed. Undefined for a genre
 * without a roster. Every main role is equally likely, then every persona in
 * the role, so the spread across a run comes from the host, not the author.
 */
export function castOffer(cast: readonly CastPersona[] | undefined, seed: string, sideOnlyRate = SIDE_ONLY_RATE): CastOffer | undefined {
  if (!cast?.length) return undefined;
  const of = (role: CastRole) => cast.filter((p) => p.role === role);
  const sides = shuffled(of('side'), seed, 'side');
  const nemeses = shuffled(of('nemesis'), seed, 'nemesis');
  const roles = MAIN_ROLES.filter((r) => of(r).length);
  const sideOnly = sides.length >= OFFER_SIZE - 1 && (!roles.length || hash(`side-only\0${seed}`) / 0x1_0000_0000 < sideOnlyRate);
  const picks: CastPersona[] = [];
  if (sideOnly) {
    picks.push(...nemeses.slice(0, 1), ...sides.slice(0, OFFER_SIZE - Math.min(1, nemeses.length)));
  } else {
    const roleOrder = [...roles].sort((a, b) => hash(`role\0${seed}\0${a}`) - hash(`role\0${seed}\0${b}`));
    for (const role of roleOrder.slice(0, 3)) picks.push(shuffled(of(role), seed, role)[0]!);
    picks.push(...nemeses.slice(0, 1), ...sides.slice(0, 1));
    // A short roster: fill from whatever is left, so the offer is still five.
    for (const p of shuffled(cast, seed, 'fill')) if (picks.length < OFFER_SIZE && !picks.includes(p)) picks.push(p);
  }
  return { kind: sideOnly ? 'side-only' : 'party', personas: picks.slice(0, OFFER_SIZE) };
}

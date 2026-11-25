/**
 * Casting by rotation, true to the genre. A single comic can't show that a
 * repo's comics include all kinds of people; a run of comics can. Asking each
 * author to "be diverse" made every comic answer with the same one character,
 * and a generic pool of real-world identities ("a Lebanese woman", "a trans
 * man") dropped people into genres they don't belong to. So each genre carries
 * its own diverse archetypes, drawn from the genre's source works (a
 * dark-skinned elf knight, two heroines in love, a station commander), and the
 * host requires one in about one comic in five.
 */
import { createHash } from 'node:crypto';

/** About one comic in five must cast one of its genre's diverse archetypes. */
export const DIVERSE_RATE = 1 / 5;

const hash = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);

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
  /** A party role (CAST_ROLES), or any role word for a diverse archetype (a captain, a pilot). */
  role: CastRole | (string & {});
  /** The persona in a few words. */
  name: string;
  /** Quirk, look and the kind of joke they carry. */
  details: string;
  /** A diverse archetype the host requires in this comic (diverseHint). */
  required?: true;
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

/**
 * Parses a roster entry, `role: name — details`; undefined when malformed.
 * A cast roster's roles are the party roles; `anyRole` accepts any lowercase
 * word (a diverse archetype for a genre without a party, such as a captain).
 */
export function parseCastEntry(entry: string, opts: { anyRole?: boolean } = {}): CastPersona | undefined {
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s+[—–-]{1,2}\s+(.+?)\s*$/.exec(entry);
  if (!m) return undefined;
  const role = m[1] as CastRole;
  if (!opts.anyRole && !CAST_ROLES.includes(role)) return undefined;
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

/**
 * The diverse archetype this comic must cast, or undefined (most comics).
 * Stable for a seed; every archetype in the genre's list is equally likely.
 */
export function diverseHint(list: readonly CastPersona[] | undefined, seed: string, rate = DIVERSE_RATE): CastPersona | undefined {
  if (!list?.length || hash(`diverse\0${seed}`) / 0x1_0000_0000 >= rate) return undefined;
  return { ...list[hash(`diverse-pick\0${seed}`) % list.length]!, required: true };
}

/**
 * Puts a required archetype into a cast offer: it takes the place of the
 * offered persona with its role, else the side character, else the last one.
 */
export function withRequired(offer: CastOffer, persona: CastPersona): CastOffer {
  const personas = [...offer.personas];
  const at = [personas.findIndex((p) => p.role === persona.role), personas.findIndex((p) => p.role === 'side'), personas.length - 1].find((i) => i >= 0)!;
  personas[at] = persona;
  return { ...offer, personas };
}

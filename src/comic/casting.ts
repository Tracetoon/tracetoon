/**
 * Casting by rotation. A single comic can't show that a repo's comics include
 * all kinds of people; a run of comics can. Asking every author to "be
 * diverse" made each comic answer with the same one character, so instead
 * the host occasionally offers one concrete, optional suggestion, drawn by
 * seed from a broad pool. Most comics get none and simply cast what the
 * story and genre call for.
 */
import { createHash } from 'node:crypto';

/** Roughly one comic in three gets a suggestion. */
export const CAST_HINT_RATE = 1 / 3;

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

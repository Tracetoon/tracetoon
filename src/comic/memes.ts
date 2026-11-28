/**
 * Genre memes: the famous scenes, lines and tropes veteran fans of a genre
 * recognise. A genre keeps hundreds; each comic is offered three, picked by
 * seed (weighted toward the best known, matched to the comic's cast, never one
 * a recent comic used), so a run of comics doesn't settle on the same few. The
 * author may use one when it fits the joke, as an allusion, never by name.
 *
 * Style mixes live here too: a genre can weight its styles, and the host then
 * assigns each comic's style by seed instead of leaving it to the author.
 */
import { createHash } from 'node:crypto';
import spaceOpera from './memes/space-opera.json' with { type: 'json' };

export interface Meme {
  /** Short stable id the script records in `meme`. */
  id: string;
  /** 1: iconic; 2: well known; 3: a deeper cut for veterans. */
  tier: 1 | 2 | 3;
  /** Who carries it best (cast roles, or genre-specific roles), or `any`. */
  roles: string[];
  /** The meme as an allusion, without naming the work. */
  meme: string;
  /** The kind of software moment it fits. */
  use: string;
}

export const MEMES_OFFERED = 3;
export const MAX_MEME_ENTRY = 280;
const TIER_WEIGHT = { 1: 3, 2: 2, 3: 1 } as const;

const hash = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');

type RawMeme = { tier: number; roles: string[]; meme: string; use: string };

/** Gives each meme an id; a repeated slug gets a numeric suffix. */
export function withIds(raw: readonly RawMeme[]): Meme[] {
  const seen = new Map<string, number>();
  return raw.map((m) => {
    const base = slug(m.meme);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      id: n === 1 ? base : `${base}-${n}`,
      tier: (m.tier === 1 || m.tier === 3 ? m.tier : 2) as Meme['tier'],
      roles: m.roles.length ? m.roles.map((r) => r.toLowerCase()) : ['any'],
      meme: m.meme.trim(),
      use: m.use.trim(),
    };
  });
}

/** Built-in pools by genre id. */
export const BUILT_IN_MEMES: Record<string, Meme[]> = {
  'space-opera': withIds(spaceOpera as RawMeme[]),
};

/** Parses a genre-file entry, `tier roles: meme — use` (roles comma-separated). */
export function parseMemeEntry(entry: string): RawMeme | undefined {
  const m = /^\s*([123])\s+([a-z,\s]+?)\s*:\s*(.+?)\s+[—–]\s+(.+?)\s*$/.exec(entry);
  if (!m) return undefined;
  const roles = m[2]!.split(',').map((r) => r.trim()).filter(Boolean);
  return { tier: Number(m[1]), roles, meme: m[3]!, use: m[4]! };
}

/**
 * Three memes for this comic, stable for a seed. Memes recent comics used are
 * skipped; memes for the comic's cast roles (or `any`) are preferred when the
 * comic has a cast offer; tier 1 is three times as likely as tier 3.
 */
export function memeOffer(
  memes: readonly Meme[] | undefined,
  seed: string,
  opts: { roles?: string[]; recent?: string[] } = {},
): Meme[] | undefined {
  if (!memes?.length) return undefined;
  const recent = new Set(opts.recent ?? []);
  let pool = memes.filter((m) => !recent.has(m.id));
  if (pool.length < MEMES_OFFERED) pool = [...memes];
  if (opts.roles?.length) {
    const roles = new Set(opts.roles);
    const fits = pool.filter((m) => m.roles.includes('any') || m.roles.some((r) => roles.has(r)));
    if (fits.length >= MEMES_OFFERED) pool = fits;
  }
  // Weighted sampling without replacement: the smallest -log(u)/weight keys win.
  return pool
    .map((m) => ({ m, key: -Math.log((hash(`meme\0${seed}\0${m.id}`) + 1) / 0x1_0000_0001) / TIER_WEIGHT[m.tier] }))
    .sort((a, b) => a.key - b.key)
    .slice(0, MEMES_OFFERED)
    .map(({ m }) => m);
}

/** Parses a genre-file style-mix entry, `style weight`. */
export function parseStyleMixEntry(entry: string): [string, number] | undefined {
  const m = /^\s*([a-z0-9-]+)\s+(\d+(?:\.\d+)?)\s*$/.exec(entry);
  return m && Number(m[2]) > 0 ? [m[1]!, Number(m[2])] : undefined;
}

/** The style the host assigns this comic from a genre's weighted mix; undefined without a mix. */
export function stylePick(mix: Record<string, number> | undefined, seed: string): string | undefined {
  const entries = Object.entries(mix ?? {}).filter(([, w]) => w > 0);
  if (!entries.length) return undefined;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = (hash(`style\0${seed}`) / 0x1_0000_0000) * total;
  for (const [style, w] of entries) {
    if ((x -= w) < 0) return style;
  }
  return entries[entries.length - 1]![0];
}

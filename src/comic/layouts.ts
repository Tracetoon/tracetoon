/**
 * Layout variety by assignment: authors left to choose settle on a 4-panel
 * grid (a wide opener, a middle pair, a wide closer). The host assigns each
 * comic one composition family at random, never one of the last few comics'
 * families, and weighted away from the familiar grids. A comic with action
 * beats may use an action family instead (types.ts ACTION_FAMILIES).
 */
import { createHash } from 'node:crypto';
import type { LayoutFamily } from './types.ts';

/** How likely each family is to be assigned. Grids that were the default count half. */
export const LAYOUT_WEIGHTS: Partial<Record<LayoutFamily, number>> = {
  tiered: 0.5,
  staggered: 0.5,
  asymmetric: 1,
  slanted: 1,
  splash: 1,
  'hero-inset': 1,
  vertical: 1,
  sequence: 1,
  columns: 1,
  'tall-left': 1,
  'big-middle': 1,
  zigzag: 1,
  shattered: 1,
  burst: 1,
};

/** How many recent comics' families are out of rotation. */
export const LAYOUT_COOLDOWN = 3;

const unit = (seed: string) => createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;

/** This comic's layout family: weighted at random, skipping the last few comics' families. */
export function layoutPick(seed: string, recentLayouts: string[] = []): LayoutFamily {
  const resting = new Set(recentLayouts.slice(0, LAYOUT_COOLDOWN));
  let entries = (Object.entries(LAYOUT_WEIGHTS) as [LayoutFamily, number][]).filter(([f]) => !resting.has(f));
  if (!entries.length) entries = Object.entries(LAYOUT_WEIGHTS) as [LayoutFamily, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = unit(`layout\0${seed}`) * total;
  for (const [family, w] of entries) if ((x -= w) < 0) return family;
  return entries[entries.length - 1]![0];
}

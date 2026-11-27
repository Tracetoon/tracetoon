/**
 * Layout variety by assignment: authors left to choose settle on one 4-panel
 * grid (a wide opener, a middle pair, a wide closer). The host assigns each
 * comic a tiled structure (grid.ts signature) for each panel count it may
 * use, at random, never one the last few comics used, and weighted away from
 * that old default. Slants come from the panels' motion, not the assignment.
 */
import { createHash } from 'node:crypto';
import { SIGNATURES } from './grid.ts';

/** The panel counts a comic is assigned a structure for: 3 or 4 (5-panel pages read cramped at PR width, round 16). */
export const ASSIGNED_COUNTS = [3, 4] as const;
/** How many recent comics' signatures are out of rotation. */
export const LAYOUT_COOLDOWN = 3;
/** Signatures that were the default count less. */
export const LAYOUT_WEIGHTS: Record<string, number> = { 'rows:1-2-1': 0.3, 'rows:1-1-1': 0.6 };
/** Three panels across one band are small at PR width (round 16's weakest visuals): they count this much. */
export const THREE_ACROSS_WEIGHT = 0.35;

const weightOf = (sig: string) => LAYOUT_WEIGHTS[sig] ?? (/[:-]3(-|$)/.test(sig) ? THREE_ACROSS_WEIGHT : 1);

const unit = (seed: string) => createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;

/** One signature for a panel count: weighted at random, skipping recently used ones. */
export function signaturePick(count: number, seed: string, recent: string[] = []): string {
  const resting = new Set(recent);
  let options = (SIGNATURES[count] ?? []).filter((s) => !resting.has(s));
  if (!options.length) options = SIGNATURES[count] ?? [];
  const weights = options.map(weightOf);
  let x = unit(`layout\0${count}\0${seed}`) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) if ((x -= weights[i]!) < 0) return options[i]!;
  return options[options.length - 1]!;
}

/**
 * This comic's structures, by panel count: the author picks how many panels
 * the story needs and uses that one. `recentSignatures` are the newest
 * comics' signatures, newest first (one or more per comic).
 */
export function layoutPick(seed: string, recentSignatures: string[][] = []): Record<string, string> {
  const resting = recentSignatures.slice(0, LAYOUT_COOLDOWN).flat();
  return Object.fromEntries(ASSIGNED_COUNTS.map((n) => [String(n), signaturePick(n, seed, resting)]));
}

/**
 * Tiled page layouts. A signature names the structure: an orientation and the
 * number of panels in each band ("rows:1-2" is one wide panel over two;
 * "cols:1-3" is one tall panel beside three stacked). The generator cuts the
 * page into exactly those panels:
 *
 * - the panels tile the page: every point inside the margins is in one panel
 *   or one gutter, with no voids, overlaps or insets;
 * - the outer edges stay straight along the page border; angles only appear
 *   on interior gutters, and only beside move or impact panels, leaning with
 *   the motion;
 * - no panel is a sliver: each keeps a minimum width, height and lettering box.
 *
 * Work happens in a unit square for the content area; "cols" layouts are
 * computed as rows and transposed. The result is today's PanelFrame (bounds,
 * plus a clip polygon and lettering box when a side is slanted).
 */
import { createHash } from 'node:crypto';
import type { FrameBounds, PanelFrame, PanelMotion } from './types.ts';

export type Orientation = 'rows' | 'cols';
export interface Signature {
  orientation: Orientation;
  /** Panels in each band, in reading order. */
  bands: number[];
}

/**
 * Every signature the generator draws, by panel count. At most 3 bands of at
 * most 3 panels. Column layouts always open with the tall panel on the left:
 * a tall panel beside a stack is only read in order when it comes first
 * (Cohn 2013; Shanower).
 */
export const SIGNATURES: Record<number, string[]> = {
  2: ['rows:1-1', 'rows:2'],
  3: ['rows:1-2', 'rows:2-1', 'rows:3', 'rows:1-1-1', 'cols:1-2'],
  4: ['rows:1-2-1', 'rows:2-2', 'rows:1-3', 'rows:3-1', 'rows:2-1-1', 'rows:1-1-2', 'cols:1-3'],
  5: ['rows:2-1-2', 'rows:1-2-2', 'rows:2-2-1', 'rows:2-3', 'rows:3-2', 'rows:1-3-1', 'cols:1-2-2'],
  6: ['rows:2-2-2', 'rows:1-2-3', 'rows:3-2-1'],
};

export function parseSignature(sig: string): Signature | undefined {
  const m = /^(rows|cols):([1-3](?:-[1-3]){0,2})$/.exec(sig);
  if (!m) return undefined;
  return { orientation: m[1] as Orientation, bands: m[2]!.split('-').map(Number) };
}

export const panelsIn = (sig: string) => parseSignature(sig)?.bands.reduce((s, n) => s + n, 0) ?? 0;

/** Page margins and gutter, as fractions of the page (the same as the hand-built families). */
const MARGIN = 0.025;
const GUTTER = 0.025;
/** How far a slanted gutter's two ends differ, as a share of the band it crosses (and never more than MAX_SLANT of the page). */
const SLANT_SHARE = 0.22;
const MAX_SLANT = 0.08;
/** Minimum panel size as fractions of the page. */
export const MIN_W = 0.16;
export const MIN_H = 0.12;

type Pt = [number, number];
/** A line through two points; used for cuts in the unit square. */
type Line = { a: Pt; b: Pt };

const unit = (seed: string) => createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;
const choose = <T,>(xs: T[], seed: string): T => xs[Math.floor(unit(seed) * xs.length) % xs.length]!;

function intersect(p: Line, q: Line): Pt {
  const [x1, y1] = p.a;
  const [x2, y2] = p.b;
  const [x3, y3] = q.a;
  const [x4, y4] = q.b;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-12) return [x1, y1];
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/** Band sizes: the band holding the dominant panel is larger. */
const bandWeights = (k: number, seed: string, dominant: number): number[] => {
  if (k === 1) return [1];
  const base = k === 2 ? choose([[1, 1], [1.25, 1], [1, 1.25]], seed) : choose([[1, 1, 1], [1.15, 1, 1], [1, 1.15, 1], [1, 1, 1.15]], seed);
  const out = [...base];
  if (dominant >= 0) out[dominant] = Math.max(...base) + 0.3;
  return out;
};

/** Interior cut positions (0–1) a band of k cells may use; every cell keeps at least MIN_SHARE. */
const MIN_SHARE = 0.24;
const CUTS: Record<number, number[][]> = {
  1: [[]],
  2: [[0.5], [0.38], [0.62], [0.44], [0.56]],
  3: [0.24, 0.25, 0.27, 0.31, 0.333, 0.37].flatMap((a) => [0.5, 0.52, 0.55, 0.6, 0.64, 0.667, 0.7, 0.74, 0.76].map((b): number[] => [a, b])).filter((c) => c[1]! - c[0]! >= MIN_SHARE && 1 - c[1]! >= MIN_SHARE),
};
/** How far apart the gutters of two stacked bands must sit, so no four-way crossing forms (R3). */
export const STAGGER = 0.12;

const lean = (m: PanelMotion | undefined): number => (m?.direction === 'left' || m?.direction === 'up' ? -1 : 1);

export interface GridPanel {
  /** Polygon in page coordinates, corners clockwise from top-left. */
  polygon: Pt[];
  frame: PanelFrame;
}

/** A slanted gutter: the panels on either side, and which way its top leans. */
export interface GridSlant {
  before: number[];
  after: number[];
  lean: 'left' | 'right';
}

export interface GridLayout {
  panels: GridPanel[];
  slants: GridSlant[];
  /** Interior cut positions per band (0–1 across the band), for the stagger check. */
  cuts: number[][];
}

/**
 * The panels of a signature on the page area (top..bottom in page fractions),
 * in reading order, following comic layout conventions:
 *
 * - column layouts put the tall panel first (left), the only reading-safe
 *   arrangement of a tall panel beside a stack (Cohn 2013; Shanower);
 * - stacked bands never line their gutters up into a four-way crossing: the
 *   cuts of neighbouring bands sit at least STAGGER apart;
 * - only vertical gutters on the page may slant, and only one per page: the
 *   one beside the peak action panel (impact first, then move). A second slant
 *   only for a second impact beat in another band. Calm pages have none (R1, R2);
 * - every gutter is the same width in pixels, rows and columns alike, on any
 *   page shape (owner's decision, round 19; `aspect` is width / height).
 */
export function gridLayout(sig: string, motions: (PanelMotion | undefined)[], seed: string, top = MARGIN, aspect = 1): GridLayout {
  const s = parseSignature(sig);
  if (!s) return { panels: [], slants: [], cuts: [] };
  const n = s.bands.reduce((a, b) => a + b, 0);
  const cols = s.orientation === 'cols';
  const X0 = MARGIN, X1 = 1 - MARGIN, Y0 = top, Y1 = 1 - MARGIN;
  // Gutters in unit-square terms. GUTTER is a share of the page width; a row
  // gutter of the same pixel width is GUTTER * aspect of the page height.
  const colGap = GUTTER / (X1 - X0);
  const tierGap = (GUTTER * aspect) / (Y1 - Y0);
  // In rows-space: "across" separates cells in a band, "along" separates bands.
  const gAcross = cols ? tierGap : colGap;
  const gAlong = cols ? colGap : tierGap;
  const bandOf: number[][] = [];
  let k = 0;
  for (const count of s.bands) bandOf.push(Array.from({ length: count }, () => k++));
  const bandIndex = (p: number) => bandOf.findIndex((b) => b.includes(p));
  // The peak action beat, and a second impact in another band.
  const kinds = motions.map((m) => m?.kind ?? 'still');
  const peak = kinds.indexOf('impact') >= 0 ? kinds.indexOf('impact') : kinds.indexOf('move');
  const second = peak < 0 ? -1 : kinds.findIndex((kind, i) => kind === 'impact' && i !== peak && bandIndex(i) !== bandIndex(peak));
  const dominantPanel = peak >= 0 ? peak : n - 1;
  // Band sizes along the page.
  const bw = bandWeights(s.bands.length, `${seed}\0bands`, bandIndex(dominantPanel));
  const bTotal = bw.reduce((a, b) => a + b, 0);
  const edges = [0];
  for (const w of bw) edges.push(edges[edges.length - 1]! + w / bTotal);
  // Cuts within each band, staggered against the band before.
  const cuts: number[][] = [];
  s.bands.forEach((count, b) => {
    const prev = b > 0 ? cuts[b - 1]! : [];
    const options = CUTS[count]!;
    const order = options.map((c, i) => ({ c, r: unit(`${seed}\0cuts ${b}\0${i}`) })).sort((x, y) => x.r - y.r).map((x) => x.c);
    const staggered = order.filter((c) => c.every((x) => prev.every((p) => Math.abs(x - p) >= STAGGER)));
    const pool = staggered.length ? staggered : order;
    const at = bandOf[b]!.indexOf(dominantPanel);
    const share = (c: number[], i: number) => [0, ...c, 1][i + 1]! - [0, ...c, 1][i]!;
    const best = at >= 0 && count > 1 ? [...pool].sort((x, y) => share(y, at) - share(x, at))[0]! : pool[0]!;
    cuts.push(best);
  });
  // Which cuts slant: on the page they must be vertical gutters.
  const slants: GridSlant[] = [];
  const slantAt = new Map<string, number>(); // key -> lean (+1 top right, -1 top left)
  const pick = (p: number) => {
    if (p < 0) return;
    const b = bandIndex(p);
    const c = bandOf[b]!.indexOf(p);
    const dir = lean(motions[p]);
    if (!cols) {
      // Rows: the vertical gutters are the cuts within a band.
      const count = s.bands[b]!;
      if (count < 2) return;
      const cut = c < count - 1 ? c + 1 : c; // the gutter to its right, else to its left
      const key = `w${b}:${cut}`;
      if (slantAt.has(key)) return;
      slantAt.set(key, dir);
      slants.push({ before: [bandOf[b]![cut - 1]!], after: [bandOf[b]![cut]!], lean: dir > 0 ? 'right' : 'left' });
    } else {
      // Columns: the vertical gutters are between bands.
      const cut = b < s.bands.length - 1 ? b + 1 : b;
      if (cut <= 0 || cut >= s.bands.length) return;
      const key = `a${cut}`;
      if (slantAt.has(key)) return;
      slantAt.set(key, dir);
      slants.push({ before: bandOf[cut - 1]!, after: bandOf[cut]!, lean: dir > 0 ? 'right' : 'left' });
    }
  };
  pick(peak);
  pick(second);
  // Lines in rows-space (u across a band, v along the bands).
  const along: Line[] = edges.map((v, i) => {
    const dir = slantAt.get(`a${i}`);
    if (!dir) return { a: [0, v], b: [1, v] };
    const w = Math.min(edges[i]! - edges[i - 1]!, edges[i + 1]! - edges[i]!);
    const d = dir * Math.min(MAX_SLANT, SLANT_SHARE * w);
    // u runs down the page here (cols), so u = 0 is the top: the top leans right when v is larger there.
    return { a: [0, v + d / 2], b: [1, v - d / 2] };
  });
  const out: { poly: Pt[]; index: number }[] = [];
  s.bands.forEach((count, b) => {
    const xs = [0, ...cuts[b]!, 1];
    const within: Line[] = xs.map((x, i) => {
      const dir = slantAt.get(`w${b}:${i}`);
      if (!dir) return { a: [x, 0], b: [x, 1] };
      const w = Math.min(xs[i]! - xs[i - 1]!, xs[i + 1]! - xs[i]!);
      const d = dir * Math.min(MAX_SLANT, SLANT_SHARE * w);
      return { a: [x + d / 2, edges[b]!], b: [x - d / 2, edges[b + 1]!] };
    });
    bandOf[b]!.forEach((p, c) => {
      const shiftU = (l: Line, by: number): Line => ({ a: [l.a[0] + by, l.a[1]], b: [l.b[0] + by, l.b[1]] });
      const shiftV = (l: Line, by: number): Line => ({ a: [l.a[0], l.a[1] + by], b: [l.b[0], l.b[1] + by] });
      const left = c === 0 ? within[0]! : shiftU(within[c]!, gAcross / 2);
      const right = c === count - 1 ? within[count]! : shiftU(within[c + 1]!, -gAcross / 2);
      const t = b === 0 ? along[0]! : shiftV(along[b]!, gAlong / 2);
      const bo = b === s.bands.length - 1 ? along[b + 1]! : shiftV(along[b + 1]!, -gAlong / 2);
      out.push({ poly: [intersect(left, t), intersect(right, t), intersect(right, bo), intersect(left, bo)], index: p });
    });
  });
  const panels = out
    .sort((a, b) => a.index - b.index)
    .map(({ poly }) => {
      const pts: Pt[] = poly.map(([u, v]): Pt => (cols ? [v, u] : [u, v])).map(([u, v]): Pt => [X0 + u * (X1 - X0), Y0 + v * (Y1 - Y0)]);
      const ordered: Pt[] = cols ? [pts[0]!, pts[3]!, pts[2]!, pts[1]!] : pts;
      return { polygon: ordered, frame: toFrame(ordered) };
    });
  return { panels, slants, cuts };
}

export function gridPanels(sig: string, motions: (PanelMotion | undefined)[], seed: string, top = MARGIN, aspect = 1): GridPanel[] {
  return gridLayout(sig, motions, seed, top, aspect).panels;
}

/** A page polygon as a PanelFrame: its bounds, plus a clip and lettering box when any side is slanted. */
function toFrame(poly: Pt[]): PanelFrame {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const rect = poly.every(([px, py]) => (Math.abs(px - x) < 1e-6 || Math.abs(px - x - w) < 1e-6) && (Math.abs(py - y) < 1e-6 || Math.abs(py - y - h) < 1e-6));
  const frame: PanelFrame = { x: round(x), y: round(y), w: round(w), h: round(h) };
  if (rect) return frame;
  const local = poly.map(([px, py]) => [round((px - x) / w), round((py - y) / h)] as [number, number]);
  // The largest axis-aligned box between the slanted sides, with a small inset.
  const [tl, tr, br, bl] = local;
  const inner: FrameBounds = {
    x: Math.max(tl![0], bl![0]) + 0.03,
    y: Math.max(tl![1], tr![1]) + 0.04,
    w: Math.min(tr![0], br![0]) - Math.max(tl![0], bl![0]) - 0.06,
    h: Math.min(bl![1], br![1]) - Math.max(tl![1], tr![1]) - 0.08,
  };
  return { ...frame, clip: local, textBox: { x: round(inner.x), y: round(inner.y), w: round(Math.max(0.05, inner.w)), h: round(Math.max(0.05, inner.h)) } };
}

/** Problems with a set of panels on the page: voids, overlaps, slivers, slanted outer edges. */
export function tilingProblems(panels: GridPanel[], top = MARGIN): string[] {
  const out: string[] = [];
  const inside = (p: Pt, poly: Pt[]) => {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (Math.abs(c) < 1e-12) continue;
      const s = Math.sign(c);
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  };
  const distToPoly = (p: Pt, poly: Pt[]) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
    }
    return best;
  };
  const N = 48;
  let voids = 0, overlaps = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const p: Pt = [MARGIN + ((i + 0.5) / N) * (1 - 2 * MARGIN), top + ((j + 0.5) / N) * (1 - MARGIN - top)];
      const hits = panels.filter((g) => inside(p, g.polygon)).length;
      if (hits > 1) overlaps++;
      if (hits === 0 && Math.min(...panels.map((g) => distToPoly(p, g.polygon))) > GUTTER * 1.2) voids++;
    }
  if (overlaps) out.push(`${overlaps} sampled points sit in two panels`);
  if (voids) out.push(`${voids} sampled points are in no panel and no gutter`);
  panels.forEach((g, i) => {
    const minW = Math.min(Math.abs(g.polygon[1]![0] - g.polygon[0]![0]), Math.abs(g.polygon[2]![0] - g.polygon[3]![0]));
    const minH = Math.min(Math.abs(g.polygon[3]![1] - g.polygon[0]![1]), Math.abs(g.polygon[2]![1] - g.polygon[1]![1]));
    if (minW < MIN_W) out.push(`panel ${i + 1} is narrower than ${MIN_W}`);
    if (minH < MIN_H) out.push(`panel ${i + 1} is shorter than ${MIN_H}`);
    // Sides on the page border stay on it, straight.
    for (let s = 0; s < 4; s++) {
      const a = g.polygon[s]!, b = g.polygon[(s + 1) % 4]!;
      const onLeft = Math.abs(a[0] - MARGIN) < 1e-6 || Math.abs(b[0] - MARGIN) < 1e-6;
      const onRight = Math.abs(a[0] - (1 - MARGIN)) < 1e-6 || Math.abs(b[0] - (1 - MARGIN)) < 1e-6;
      if ((s === 3 && onLeft && Math.abs(a[0] - b[0]) > 1e-6) || (s === 1 && onRight && Math.abs(a[0] - b[0]) > 1e-6)) out.push(`panel ${i + 1} has a slanted outer edge`);
    }
  });
  return out;
}

/** Panel numbers as words for the prompt: "2", "2 and 3", "2, 3 and 4". */
const nums = (xs: number[]) => {
  const n = xs.map((x) => String(x + 1));
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

/**
 * The page in words, for the image model: each band's panels and size, then
 * every border stated outright ("All panel borders are straight and level",
 * or exactly which gutter slants, between which panels and which way), so the
 * image model never decides where angles go.
 */
export function describeSignature(sig: string, layout: GridLayout, motions: (PanelMotion | undefined)[] = []): string {
  const s = parseSignature(sig);
  if (!s) return '';
  const word = ['', 'one panel', 'two panels side by side', 'three panels side by side'];
  const wordCol = ['', 'one tall panel', 'two panels stacked', 'three panels stacked'];
  // Band sizes, as shares of the page along the stacking axis.
  let k = 0;
  const sizes = s.bands.map((count) => {
    const ps = layout.panels.slice(k, k + count);
    k += count;
    const axis = s.orientation === 'rows' ? 1 : 0;
    return Math.max(...ps.flatMap((p) => p.polygon.map((q) => q[axis]))) - Math.min(...ps.flatMap((p) => p.polygon.map((q) => q[axis])));
  });
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const even = sizes.every((x) => Math.abs(x - avg) / avg < 0.12);
  // Relative sizes, not percentages: the image model drifts on figures (round 18 study); the Frame lines keep the numbers.
  const rel = (x: number) => (x > avg * 1.12 ? (s.orientation === 'rows' ? 'taller' : 'wider') : x < avg * 0.88 ? (s.orientation === 'rows' ? 'shorter' : 'narrower') : 'medium');
  k = 0;
  const parts = s.bands.map((count, b) => {
    const first = k + 1;
    k += count;
    const which = count === 1 ? `panel ${first}` : `panels ${first}–${first + count - 1}`;
    const size = even || s.bands.length === 1 ? '' : `, ${rel(sizes[b]!)}`;
    return s.orientation === 'rows'
      ? `Row ${b + 1}${size}: ${word[count]} (${which})`
      : `Column ${b + 1}${size}: ${wordCol[count]} (${which})`;
  });
  const n = s.bands.reduce((a, b) => a + b, 0);
  const unit = s.orientation === 'rows' ? 'row' : 'column';
  const lead = `${n} panels in ${s.bands.length} ${unit}${s.bands.length > 1 ? 's' : ''}${s.bands.length > 1 ? `: ${s.bands.join(', then ')}` : ''}${even && s.bands.length > 1 ? `, the ${unit}s of equal ${s.orientation === 'rows' ? 'height' : 'width'}` : ''}`;
  const why = (i: number) => (motions[i]?.kind === 'impact' ? 'for the impact' : 'for the motion');
  const borders = layout.slants.length
    ? `All panel borders are straight and level except ${layout.slants.length === 1 ? 'one' : 'two'}: ${layout.slants
        .map((g) => `the gutter between panel${g.before.length > 1 ? 's' : ''} ${nums(g.before)} and panel${g.after.length > 1 ? 's' : ''} ${nums(g.after)} slants, its top leaning ${g.lean}, ${why([...g.before, ...g.after].find((i) => motions[i] && motions[i]!.kind !== 'still') ?? g.after[0]!)}`)
        .join('; ')}. The rows themselves stay level.`
    : 'All panel borders are straight and level.';
  return `${lead}. ${parts.join('. ')}. ${borders} The panels fill the page edge to edge, with the same narrow white gap between every pair of neighbouring panels: no empty areas, no overlapping panels, no inset panels.`;
}

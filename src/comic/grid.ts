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

/** Every signature the generator draws, by panel count. At most 3 bands of at most 3 panels. */
export const SIGNATURES: Record<number, string[]> = {
  2: ['rows:1-1', 'rows:2'],
  3: ['rows:1-2', 'rows:2-1', 'rows:3', 'rows:1-1-1', 'cols:1-2', 'cols:2-1'],
  4: ['rows:1-2-1', 'rows:2-2', 'rows:1-3', 'rows:3-1', 'rows:2-1-1', 'rows:1-1-2', 'cols:1-3', 'cols:3-1', 'cols:1-2-1'],
  5: ['rows:2-1-2', 'rows:1-2-2', 'rows:2-2-1', 'rows:2-3', 'rows:3-2', 'rows:1-3-1', 'cols:1-2-2', 'cols:2-1-2', 'cols:2-3'],
  6: ['rows:2-2-2', 'rows:3-3', 'rows:1-2-3', 'rows:3-2-1', 'cols:2-2-2'],
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

const weightsFor = (k: number, seed: string, dominant: number | undefined): number[] => {
  if (k === 1) return [1];
  const base = k === 2 ? choose([[1, 1], [1.6, 1], [1, 1.6]], seed) : choose([[1, 1, 1], [1.4, 1, 1], [1, 1.4, 1], [1, 1, 1.4]], seed);
  if (dominant === undefined) return base;
  // The dominant panel gets the biggest share.
  const max = Math.max(...base);
  const out = base.map((w) => (w === max && max > 1 ? 1 : w));
  out[dominant] = Math.max(max, 1.4);
  return out;
};

const lean = (m: PanelMotion | undefined, fallback: number): number => {
  if (!m || m.kind === 'still') return 0;
  if (m.direction === 'left' || m.direction === 'up') return -1;
  if (m.direction === 'right' || m.direction === 'down') return 1;
  return fallback;
};

export interface GridPanel {
  /** Polygon in page coordinates, corners clockwise from top-left. */
  polygon: Pt[];
  frame: PanelFrame;
}

/**
 * The panels of a signature on the page area (top..bottom in page fractions),
 * in reading order. `motions` are the panels' motion, by index.
 */
export function gridPanels(sig: string, motions: (PanelMotion | undefined)[], seed: string, top = MARGIN): GridPanel[] {
  const s = parseSignature(sig);
  if (!s) return [];
  const n = s.bands.reduce((a, b) => a + b, 0);
  const cols = s.orientation === 'cols';
  // Content area in page fractions.
  const X0 = MARGIN, X1 = 1 - MARGIN, Y0 = top, Y1 = 1 - MARGIN;
  // Gutters in unit-square terms along each axis (before any transposition).
  const gX = GUTTER / (X1 - X0);
  const gY = GUTTER / (Y1 - Y0);
  const [gAcross, gAlong] = cols ? [gY, gX] : [gX, gY]; // gAcross: between cells in a band; gAlong: between bands
  const action = motions.map((m) => !!m && m.kind !== 'still');
  // Index of panels per band.
  const bandOf: number[][] = [];
  let k = 0;
  for (const count of s.bands) bandOf.push(Array.from({ length: count }, () => k++));
  const last = n - 1;
  const actionIdx = action.findIndex(Boolean);
  const dominantPanel = actionIdx >= 0 ? actionIdx : last;
  // Band sizes: the band holding the dominant panel is larger.
  const bw = weightsFor(s.bands.length, `${seed}\0bands`, bandOf.findIndex((b) => b.includes(dominantPanel)));
  const bTotal = bw.reduce((a, b) => a + b, 0);
  const bandEdges = [0];
  for (const w of bw) bandEdges.push(bandEdges[bandEdges.length - 1]! + w / bTotal);
  // Horizontal cuts between bands (in "rows" space: y as a function of x), slanted beside action panels.
  const cutsBetween: Line[] = bandEdges.map((y, i) => {
    if (i === 0 || i === bandEdges.length - 1) return { a: [0, y], b: [1, y] };
    const touching = [...bandOf[i - 1]!, ...bandOf[i]!];
    const mover = touching.find((p) => action[p]);
    const dir = mover === undefined ? 0 : lean(motions[mover], i % 2 ? 1 : -1);
    const h = Math.min(bandEdges[i]! - bandEdges[i - 1]!, bandEdges[i + 1]! - bandEdges[i]!);
    const d = dir * Math.min(MAX_SLANT, SLANT_SHARE * h);
    return { a: [0, y - d / 2], b: [1, y + d / 2] };
  });
  const out: { poly: Pt[]; index: number }[] = [];
  s.bands.forEach((count, b) => {
    const idx = bandOf[b]!;
    const dominant = idx.indexOf(dominantPanel);
    const cw = weightsFor(count, `${seed}\0band ${b}`, dominant >= 0 ? dominant : undefined);
    const cTotal = cw.reduce((a, c) => a + c, 0);
    const xs = [0];
    for (const w of cw) xs.push(xs[xs.length - 1]! + w / cTotal);
    const topCut = cutsBetween[b]!;
    const botCut = cutsBetween[b + 1]!;
    // Vertical cuts within the band, slanted beside action panels.
    const vcuts: Line[] = xs.map((x, i) => {
      if (i === 0 || i === xs.length - 1) return { a: [x, 0], b: [x, 1] };
      const mover = [idx[i - 1]!, idx[i]!].find((p) => action[p]);
      const dir = mover === undefined ? 0 : lean(motions[mover], i % 2 ? 1 : -1);
      const w = Math.min(xs[i]! - xs[i - 1]!, xs[i + 1]! - xs[i]!);
      const d = dir * Math.min(MAX_SLANT, SLANT_SHARE * w);
      const yTop = bandEdges[b]!;
      const yBot = bandEdges[b + 1]!;
      return { a: [x + d / 2, yTop], b: [x - d / 2, yBot] };
    });
    idx.forEach((p, c) => {
      // Shrink each side by half a gutter, except along the page border.
      const shiftV = (l: Line, by: number): Line => ({ a: [l.a[0] + by, l.a[1]], b: [l.b[0] + by, l.b[1]] });
      const shiftH = (l: Line, by: number): Line => ({ a: [l.a[0], l.a[1] + by], b: [l.b[0], l.b[1] + by] });
      const left = c === 0 ? vcuts[0]! : shiftV(vcuts[c]!, gAcross / 2);
      const right = c === count - 1 ? vcuts[count]! : shiftV(vcuts[c + 1]!, -gAcross / 2);
      const t = b === 0 ? topCut : shiftH(topCut, gAlong / 2);
      const bo = b === s.bands.length - 1 ? botCut : shiftH(botCut, -gAlong / 2);
      out.push({ poly: [intersect(left, t), intersect(right, t), intersect(right, bo), intersect(left, bo)], index: p });
    });
  });
  // Back to page coordinates (transposing "cols" layouts), clockwise from top-left.
  return out
    .sort((a, b) => a.index - b.index)
    .map(({ poly }) => {
      const pts: Pt[] = poly.map(([u, v]): Pt => (cols ? [v, u] : [u, v])).map(([u, v]): Pt => [X0 + u * (X1 - X0), Y0 + v * (Y1 - Y0)]);
      // Transposition mirrors the winding; keep corners as top-left, top-right, bottom-right, bottom-left.
      const ordered: Pt[] = cols ? [pts[0]!, pts[3]!, pts[2]!, pts[1]!] : pts;
      return { polygon: ordered, frame: toFrame(ordered) };
    });
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

/** The structure in words, for the image model: "Row 1, 40% of the height: one panel. Row 2: two panels…". */
export function describeSignature(sig: string, panels: GridPanel[]): string {
  const s = parseSignature(sig);
  if (!s) return '';
  const word = ['', 'one panel', 'two panels side by side', 'three panels side by side'];
  const wordCol = ['', 'one tall panel', 'two panels stacked', 'three panels stacked'];
  let k = 0;
  const parts = s.bands.map((count, b) => {
    const ps = panels.slice(k, k + count);
    k += count;
    const ext = s.orientation === 'rows'
      ? Math.max(...ps.map((p) => Math.max(...p.polygon.map((q) => q[1])))) - Math.min(...ps.map((p) => Math.min(...p.polygon.map((q) => q[1]))))
      : Math.max(...ps.map((p) => Math.max(...p.polygon.map((q) => q[0])))) - Math.min(...ps.map((p) => Math.min(...p.polygon.map((q) => q[0]))));
    const slanted = ps.some((p) => p.frame.clip);
    return s.orientation === 'rows'
      ? `Row ${b + 1} (about ${Math.round(ext * 100)}% of the page height): ${word[count]}${slanted ? ', with a slanted gutter' : ''}`
      : `Column ${b + 1} (about ${Math.round(ext * 100)}% of the page width): ${wordCol[count]}${slanted ? ', with a slanted gutter' : ''}`;
  });
  return `${parts.join('. ')}. The panels fill the page edge to edge with even gutters: no empty areas, no overlapping panels, no inset panels.`;
}

/** Shared art direction. Legacy v2 scripts intentionally retain their old defaults. */
import { createHash } from 'node:crypto';
import { formatById } from './formats.ts';
import { STYLES } from './styles.ts';
import { genreKey } from './genres.ts';
import {
  ACTION_FAMILIES,
  DIRECTIONS,
  LAYOUT_FAMILIES,
  MOTIONS,
  type Aspect,
  type ComicScript,
  type ComicSummary,
  type Composition,
  type FrameBounds,
  type PanelFrame,
  type StyleFamily,
} from './types.ts';

export function pageAspect(script: ComicScript): Aspect {
  return (
    script.aspect ??
    (script.composition?.family === 'vertical'
      ? '3:4'
      : (formatById(script.format)?.aspect ?? '4:3'))
  );
}
export function aspectRatio(aspect: Aspect): number {
  const [w, h] = aspect.split(':').map(Number);
  return w! / h!;
}
export function visibleHeadline(script: ComicScript): string {
  const value =
    script.composition?.title?.mode === 'none' ? '' : (script.headline ?? script.title);
  return typeof value === 'string' ? value : '';
}

export function resolveComposition(
  script: ComicScript,
): (Composition & { frames: PanelFrame[] }) | undefined {
  const c = script.composition;
  if (!c) return;
  if (c.frames) return { ...c, frames: c.frames };
  const n = script.panels.length;
  const top = c.title.mode === 'heading' ? 0.14 : 0.025;
  const height = 0.975 - top;
  const frame = (x: number, y: number, w: number, h: number): PanelFrame => ({
    x,
    y: top + y * height,
    w,
    h: h * height,
  });
  const gap = 0.025;
  let frames: PanelFrame[];
  switch (c.family) {
    case 'single':
      frames = [frame(0.025, 0, 0.95, 1)];
      break;
    case 'comparison':
    case 'sequence': {
      const w = (0.95 - gap * (n - 1)) / n;
      frames = Array.from({ length: n }, (_, i) => frame(0.025 + i * (w + gap), 0, w, 1));
      break;
    }
    case 'vertical': {
      const h = (1 - gap * (n - 1)) / n;
      frames = Array.from({ length: n }, (_, i) => frame(0.025, i * (h + gap), 0.95, h));
      break;
    }
    case 'asymmetric': {
      // Small setup beats above a wide, visually dominant payoff.
      const count = n - 1;
      const cols = count <= 2 ? count : 2;
      const rows = Math.ceil(count / cols);
      const w = (0.95 - gap * (cols - 1)) / cols;
      const h = (0.46 - gap * (rows - 1)) / rows;
      frames = Array.from({ length: count }, (_, i) =>
        frame(0.025 + (i % cols) * (w + gap), Math.floor(i / cols) * (h + gap), w, h),
      );
      frames.push(frame(0.025, 0.49, 0.95, 0.51));
      break;
    }
    case 'tiered': {
      // A wide establishing panel over a row of smaller beats.
      const count = n - 1;
      const w = (0.95 - gap * (count - 1)) / count;
      frames = [frame(0.025, 0, 0.95, 0.44)];
      for (let i = 0; i < count; i++)
        frames.push(frame(0.025 + i * (w + gap), 0.47, w, 0.53));
      break;
    }
    case 'hero-inset': {
      frames = [
        { ...frame(0.025, 0, 0.95, 1), textBox: { x: 0.035, y: 0.03, w: 0.56, h: 0.8 } },
      ];
      const h = (0.88 - gap * (n - 2)) / (n - 1);
      for (let i = 0; i < n - 1; i++)
        frames.push(frame(0.64, 0.045 + i * (h + gap), 0.305, h));
      break;
    }
    case 'diagonal':
      frames = [
        {
          ...frame(0.025, 0, 0.95, 1),
          clip: [
            [0, 0],
            [0.98, 0],
            [0, 0.98],
          ],
          textBox: { x: 0.035, y: 0.03, w: 0.48, h: 0.32 },
        },
        {
          ...frame(0.025, 0, 0.95, 1),
          clip: [
            [1, 0.02],
            [1, 1],
            [0.02, 1],
          ],
          textBox: { x: 0.5, y: 0.65, w: 0.46, h: 0.31 },
        },
      ];
      break;
    case 'slanted': {
      // Rows of two split by a diagonal gutter that leans the other way on
      // each row, like an action page; an odd count opens with a wide panel.
      const rowsOf: number[] = n % 2 ? [1, ...Array((n - 1) / 2).fill(2)] : Array(n / 2).fill(2);
      const rh = (1 - gap * (rowsOf.length - 1)) / rowsOf.length;
      frames = [];
      rowsOf.forEach((count, r) => {
        const y = r * (rh + gap);
        if (count === 1) {
          frames.push({ ...frame(0.025, y, 0.95, rh), textBox: { x: 0.03, y: 0.05, w: 0.94, h: 0.3 } });
          return;
        }
        const lean = r % 2 === 0;
        const t = lean ? 0.62 : 0.4;
        const b = lean ? 0.4 : 0.62;
        const g = 0.03;
        frames.push({
          ...frame(0.025, y, 0.95, rh),
          clip: [[0, 0], [t, 0], [b, 1], [0, 1]],
          textBox: { x: 0.03, y: 0.05, w: Math.min(t, b) - 0.06, h: 0.34 },
        });
        frames.push({
          ...frame(0.025, y, 0.95, rh),
          clip: [[t + g, 0], [1, 0], [1, 1], [b + g, 1]],
          textBox: { x: Math.max(t, b) + g + 0.03, y: 0.05, w: 1 - (Math.max(t, b) + g) - 0.06, h: 0.34 },
        });
      });
      break;
    }
    case 'splash': {
      // One full-page scene with small inset panels overlapping its lower edge.
      const insets = n - 1;
      const w = 0.27;
      frames = [{ ...frame(0.025, 0, 0.95, 1), textBox: { x: 0.03, y: 0.03, w: 0.6, h: 0.3 } }];
      for (let i = 0; i < insets; i++)
        frames.push({ ...frame(0.975 - 0.02 - (i + 1) * w - i * 0.02, 0.68, w, 0.28), inset: true });
      break;
    }
    case 'staggered': {
      // A broken grid: rows of two with uneven widths that swap sides.
      const rowsOf: number[] = n % 2 ? [...Array((n - 1) / 2).fill(2), 1] : Array(n / 2).fill(2);
      const rh = (1 - gap * (rowsOf.length - 1)) / rowsOf.length;
      frames = [];
      rowsOf.forEach((count, r) => {
        const y = r * (rh + gap);
        if (count === 1) {
          frames.push(frame(0.025, y, 0.95, rh));
          return;
        }
        const wide = 0.95 * 0.62 - gap / 2;
        const narrow = 0.95 - wide - gap;
        const [w1, w2] = r % 2 === 0 ? [wide, narrow] : [narrow, wide];
        frames.push(frame(0.025, y, w1, rh));
        frames.push(frame(0.025 + w1 + gap, y, w2, rh));
      });
      break;
    }
    case 'columns': {
      // Tall panels side by side, read left to right.
      const w = (0.95 - gap * (n - 1)) / n;
      frames = Array.from({ length: n }, (_, i) => frame(0.025 + i * (w + gap), 0, w, 1));
      break;
    }
    case 'tall-left': {
      // One tall opening panel on the left, the rest stacked on the right.
      const left = 0.46;
      const right = 0.95 - left - gap;
      const h = (1 - gap * (n - 2)) / (n - 1);
      frames = [frame(0.025, 0, left, 1)];
      for (let i = 0; i < n - 1; i++) frames.push(frame(0.025 + left + gap, i * (h + gap), right, h));
      break;
    }
    case 'big-middle': {
      // Small beats above and below one dominant middle panel.
      const above = Math.floor((n - 1) / 2);
      const below = n - 1 - above;
      const small = 0.24;
      const row = (count: number, y: number) => {
        const w = (0.95 - gap * (count - 1)) / count;
        return Array.from({ length: count }, (_, i) => frame(0.025 + i * (w + gap), y, w, small));
      };
      frames = [...row(above, 0), frame(0.025, small + gap, 0.95, 1 - 2 * (small + gap)), ...row(below, 1 - small)];
      break;
    }
    case 'zigzag': {
      // A staircase: each panel steps across from the one before.
      const w = 0.58;
      const h = (1 - gap * (n - 1)) / n;
      frames = Array.from({ length: n }, (_, i) => frame(0.025 + (i % 2 ? 0.95 - w : 0), i * (h + gap), w, h));
      break;
    }
    case 'shattered': {
      // Bands cut by gutters at different angles, like a page splintered by the action.
      // Angles vary from cut to cut, scaled so no band gets thinner than about a tenth of the page.
      const tilt = 1 / n - 0.14;
      const slopes = [1, -0.75, 1, -0.85].map((k) => k * tilt);
      const g = 0.018;
      const cut = (k: number) => (x: number) => (k === 0 ? 0 : k === n ? 1 : k / n + slopes[(k - 1) % slopes.length]! * (x - 0.5));
      frames = Array.from({ length: n }, (_, i) => {
        const top = cut(i);
        const bottom = cut(i + 1);
        const t0 = i === 0 ? 0 : top(0) + g;
        const t1 = i === 0 ? 0 : top(1) + g;
        const b0 = i === n - 1 ? 1 : bottom(0) - g;
        const b1 = i === n - 1 ? 1 : bottom(1) - g;
        const ty = Math.max(t0, t1) + 0.01;
        const th = Math.max(0.05, Math.min(b0, b1) - ty - 0.01);
        return {
          ...frame(0.025, 0, 0.95, 1),
          clip: [[0, t0], [1, t1], [1, b1], [0, b0]] as [number, number][],
          textBox: { x: 0.04, y: ty, w: 0.92, h: Math.min(th, 0.2) },
        };
      });
      break;
    }
    case 'burst': {
      // One full-page action panel the figure bursts out of, then tilted inset beats.
      const insets = n - 1;
      const w = 0.28;
      const spots: [number, number][] = [[0.04, 0.66], [0.68, 0.66], [0.68, 0.05]];
      frames = [{ ...frame(0.025, 0, 0.95, 1), breakout: true, textBox: { x: 0.03, y: 0.03, w: 0.55, h: 0.25 } }];
      for (let i = 0; i < insets; i++) {
        const [x, y] = spots[i % spots.length]!;
        frames.push({
          ...frame(x, y, w, 0.28),
          inset: true,
          clip: i % 2 ? [[0.05, 0], [1, 0.07], [0.95, 1], [0, 0.93]] : [[0, 0.07], [0.95, 0], [1, 0.93], [0.05, 1]],
          textBox: { x: 0.12, y: 0.14, w: 0.76, h: 0.34 },
        });
      }
      break;
    }
    default:
      frames = [];
  }
  return { ...c, frames };
}

export function titleBox(script: ComicScript): FrameBounds | undefined {
  const title = script.composition?.title;
  if (!title || title.mode === 'none') return;
  return (
    title.box ??
    (title.mode === 'heading'
      ? { x: 0.035, y: 0.015, w: 0.93, h: 0.1 }
      : { x: 0.055, y: 0.82, w: 0.55, h: 0.13 })
  );
}

export function frameAspect(script: ComicScript, index: number): Aspect {
  const f = resolveComposition(script)?.frames[index];
  if (!f) return '1:1';
  const ratio = (f.w * aspectRatio(pageAspect(script))) / f.h;
  return (['1:1', '4:3', '16:9', '3:4'] as Aspect[]).reduce((a, b) =>
    Math.abs(Math.log(aspectRatio(a) / ratio)) <
    Math.abs(Math.log(aspectRatio(b) / ratio))
      ? a
      : b,
  );
}

const percent = (n: number) => `${Math.round(n * 1000) / 10}%`;
/** What each family looks like on the page, in words an image model follows. */
const FAMILY_LOOK: Partial<Record<Composition['family'], string>> = {
  slanted: 'panels split by slanted diagonal gutters that lean the other way on each row, like a dynamic action page',
  splash: 'one dramatic full-page splash scene with small inset panels overlapping its lower edge',
  staggered: 'a broken grid of rows with uneven panel widths that swap sides from row to row',
  diagonal: 'two triangular panels split by one diagonal gutter',
  'hero-inset': 'a full-page hero scene with small inset panels down one side',
  asymmetric: 'small setup panels above one wide, dominant payoff panel',
  tiered: 'a wide establishing panel above a row of smaller beats',
  columns: 'tall vertical panels side by side, read left to right',
  'tall-left': 'one tall panel down the left side with smaller panels stacked to its right',
  'big-middle': 'small beats above and below one dominant middle panel',
  zigzag: 'a staircase of panels stepping from side to side down the page',
  shattered: 'bands of panels cut by gutters at sharply different angles, like a page splintered by the action',
  burst: 'one full-page action panel whose main figure bursts out over the border, with small tilted inset panels',
};
/** A clipped frame's corners in page percentages, e.g. "(2.5%, 14%)". */
function corners(f: PanelFrame): string {
  return (f.clip ?? [])
    .map(([x, y]) => `(${percent(f.x + x * f.w)}, ${percent(f.y + y * f.h)})`)
    .join(', ');
}
export function compositionPrompt(script: ComicScript): string {
  const c = resolveComposition(script);
  if (!c) return '';
  const look = FAMILY_LOOK[c.family];
  return [
    `Composition: ${c.family}${look ? ` (${look})` : ''}; exactly ${c.frames.length} scene(s), read left-to-right then top-to-bottom in the numbered story order. Keep each panel's size, shape and position as specified.`,
    ...c.frames.map(
      (f, i) =>
        `Frame ${i + 1}: left ${percent(f.x)}, top ${percent(f.y)}, width ${percent(f.w)}, height ${percent(f.h)}; ${f.clip ? `a slanted, non-rectangular panel with corners at ${corners(f)} on the page` : 'rectangular'}${f.inset ? ', drawn as an inset panel on top of the larger scene' : ''}; ${f.border === 'none' ? 'borderless, bleeding into its neighbours' : 'visible frame border'}${f.breakout ? '; the main figure or effect bursts out over this panel\'s border' : ''}.`,
    ),
    c.title.mode === 'none'
      ? 'No visible title or headline. Start with the art; do not reserve a title banner.'
      : `Title treatment: ${c.title.mode}; place "${visibleHeadline(script)}" inside this page area ${JSON.stringify(titleBox(script))}. ${c.title.mode === 'integrated' ? 'Integrate it into the scene; no separate top banner.' : 'Keep it inside that heading area, sized to the composition.'}`,
  ].join('\n');
}

export function artFingerprint(
  script: ComicScript,
  lettering: 'model' | 'overlay',
): string {
  // Only what the drawing is made from counts. Local reasoning, the anchor and
  // the text written about the finished art (alt text, synopsis, each panel's
  // `drawn` note) can be corrected without redrawing.
  const {
    designReason: _private,
    anchor: _anchor,
    altText: _alt,
    synopsis: _synopsis,
    ...art
  } = script;
  const panels = art.panels.map(({ drawn: _drawn, ...panel }) => panel);
  return createHash('sha256')
    .update(JSON.stringify({ art: { ...art, panels }, lettering }))
    .digest('hex');
}

/**
 * Whether a stored fingerprint belongs to this script's art. Earlier builds
 * also hashed the alt text and synopsis, so art they drew still matches while
 * that text is unchanged; `comic art` and `comic render` then re-stamp it, and
 * later text edits no longer need a redraw.
 */
export function artMatches(
  stored: string | undefined,
  script: ComicScript,
  lettering: 'model' | 'overlay',
): boolean {
  if (!stored) return false;
  if (stored === artFingerprint(script, lettering)) return true;
  const { designReason: _private, anchor: _anchor, ...art } = script;
  return (
    stored ===
    createHash('sha256').update(JSON.stringify({ art, lettering })).digest('hex')
  );
}

/** Families of presets from earlier releases; current presets carry their own. */
const LEGACY_STYLE_GROUPS: [StyleFamily, string[]][] = [
  ['flat-color', ['mecha-anime', 'rubber-hose', 'atomic-flat', 'vaporwave']],
  ['painted', ['storybook-watercolor', 'pulp-scifi']],
  ['print', ['risograph', 'ukiyo-e']],
  ['dimensional', ['claymation']],
  ['technical', ['blueprint']],
];
function presetFamily(style: string): StyleFamily | undefined {
  return (
    STYLES.find((s) => s.id === style)?.family ??
    LEGACY_STYLE_GROUPS.find(([, ids]) => ids.includes(style))?.[0]
  );
}
/** Up to six distinct lowercased names, each at most 40 characters. */
export function castNames(names: unknown[]): string[] {
  return [
    ...new Set(
      names
        .filter((n): n is string => typeof n === 'string' && !!n.trim())
        .map((n) => n.trim().toLowerCase().slice(0, 40)),
    ),
  ].slice(0, 6);
}
/** Characters in a lead look: a few words, not a description. */
export const MAX_LEAD_LOOK = 80;

/** An isekai scenario id ("AF-M08-01") and an archetype id ("M08"), as recorded in summaries. */
export const PITCH_ID = /^AF-[A-Z][0-9]{2}-[0-9]{2}$/;
export const ARCHETYPE_ID = /^[A-Z][0-9]{2}$/;

export function comicSummary(script: ComicScript): ComicSummary {
  const knownCast =
    Array.isArray(script.characters) && script.characters.every((c) => c.kind);
  return {
    style: script.style,
    ...(typeof script.genre === 'string' && script.genre.trim()
      ? { genre: genreKey(script.genre) }
      : {}),
    ...(script.styleFamily || presetFamily(script.style)
      ? { styleFamily: script.styleFamily ?? presetFamily(script.style)! }
      : {}),
    ...(script.composition
      ? {
          layoutFamily: script.composition.family,
          titleTreatment: script.composition.title.mode,
        }
      : {}),
    panelCount: script.panels.length,
    ...(knownCast
      ? { castKinds: [...new Set(script.characters.map((c) => c.kind!))].sort() }
      : {}),
    ...(Array.isArray(script.characters) && script.characters.length
      ? { castNames: castNames(script.characters.map((c) => c.name)) }
      : {}),
    ...(typeof script.leadLook === 'string' && script.leadLook.trim()
      ? { leadLook: script.leadLook.trim().toLowerCase().slice(0, MAX_LEAD_LOOK) }
      : {}),
    ...(typeof script.meme === 'string' && /^[a-z0-9-]{1,80}$/.test(script.meme) ? { meme: script.meme } : {}),
    ...(typeof script.lead?.persona === 'string' && /^[a-z0-9-]{1,80}$/i.test(script.lead.persona) ? { lead: script.lead.persona } : {}),
    ...(typeof script.castPreset === 'string' && /^[a-z_]{1,40}$/.test(script.castPreset) ? { castPreset: script.castPreset } : {}),
    ...(typeof script.pitch === 'string' && PITCH_ID.test(script.pitch) ? { pitch: script.pitch } : {}),
    ...(() => {
      const ids = (Array.isArray(script.characters) ? script.characters : []).flatMap((c) => (typeof c.archetype === 'string' && ARCHETYPE_ID.test(c.archetype) ? [c.archetype] : []));
      return ids.length ? { archetypes: [...new Set(ids)] } : {};
    })(),
  };
}

type Point = [number, number];
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
function inPolygon(p: Point, polygon: Point[]): boolean {
  const sides = polygon
    .map((a, i) => cross(a, polygon[(i + 1) % polygon.length]!, p))
    .filter((v) => Math.abs(v) > 1e-8);
  return sides.every((v) => v >= 0) || sides.every((v) => v <= 0);
}
function points(frame: PanelFrame): Point[] {
  return (
    frame.clip ?? [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
  ).map(([x, y]) => [frame.x + x * frame.w, frame.y + y * frame.h]);
}
function overlaps(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!,
        q = poly[(i + 1) % poly.length]!;
      const axis: Point = [q[1] - p[1], p[0] - q[0]];
      const pa = a.map(([x, y]) => x * axis[0] + y * axis[1]);
      const pb = b.map(([x, y]) => x * axis[0] + y * axis[1]);
      if (
        Math.min(...pa) >= Math.max(...pb) - 1e-8 ||
        Math.min(...pb) >= Math.max(...pa) - 1e-8
      )
        return false;
    }
  return true;
}
export function validBounds(value: unknown): value is FrameBounds {
  const r = value as FrameBounds | undefined;
  return (
    !!r &&
    [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w <= 1.00000001 &&
    r.y + r.h <= 1.00000001
  );
}

export function compositionProblems(
  script: ComicScript,
): { where: string; problem: string }[] {
  const c = script.composition;
  if (!c) return [];
  const out: { where: string; problem: string }[] = [];
  const bad = (where: string, problem: string) =>
    out.push({ where: `composition.${where}`, problem });
  if (!LAYOUT_FAMILIES.includes(c.family))
    bad('family', `must be ${LAYOUT_FAMILIES.join(', ')}`);
  if (!c.title || !['none', 'integrated', 'heading'].includes(c.title.mode))
    bad('title.mode', 'must be none, integrated or heading');
  if (c.title?.box !== undefined && !validBounds(c.title.box))
    bad('title.box', 'must be positive bounds within the 0–1 page');
  const limits: Partial<Record<Composition['family'], [number, number]>> = {
    single: [1, 1],
    comparison: [2, 3],
    asymmetric: [3, 6],
    'hero-inset': [2, 6],
    diagonal: [2, 2],
    tiered: [3, 5],
    slanted: [3, 7],
    splash: [2, 4],
    staggered: [3, 6],
    columns: [2, 4],
    'tall-left': [3, 4],
    'big-middle': [3, 5],
    zigzag: [3, 5],
    shattered: [3, 5],
    burst: [2, 4],
  };
  const range = limits[c.family];
  if (range && (script.panels.length < range[0] || script.panels.length > range[1]))
    bad(
      'family',
      `${c.family} needs ${range[0]}–${range[1]} panels; choose another family or explicit custom geometry`,
    );
  if (c.family === 'custom' && !Array.isArray(c.frames))
    bad('frames', 'custom composition requires explicit frames');
  if (
    c.frames !== undefined &&
    (!Array.isArray(c.frames) || c.frames.length !== script.panels.length)
  )
    bad('frames', 'must contain one frame per story panel, in reading order');
  if (out.length) return out;
  const resolved = resolveComposition(script)!;
  resolved.frames.forEach((f, i) => {
    const at = `frames[${i}]`;
    if (!validBounds(f)) {
      bad(at, 'must be positive bounds within the 0–1 page');
      return;
    }
    if (f.border !== undefined && !['line', 'none'].includes(f.border))
      bad(`${at}.border`, 'must be line or none');
    if (f.inset !== undefined && typeof f.inset !== 'boolean')
      bad(`${at}.inset`, 'must be boolean');
    if (f.breakout !== undefined && typeof f.breakout !== 'boolean')
      bad(`${at}.breakout`, 'must be boolean');
    if (f.textBox !== undefined && !validBounds(f.textBox))
      bad(`${at}.textBox`, 'must be positive bounds within the 0–1 frame');
    if (f.clip !== undefined) {
      if (
        !Array.isArray(f.clip) ||
        f.clip.length < 3 ||
        f.clip.length > 8 ||
        f.clip.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((n) => !Number.isFinite(n) || n < 0 || n > 1),
        )
      ) {
        bad(`${at}.clip`, 'use 3–8 polygon points in the frame’s 0–1 space');
        return;
      }
      const turns = f.clip.map((a, k) =>
        cross(a, f.clip![(k + 1) % f.clip!.length]!, f.clip![(k + 2) % f.clip!.length]!),
      );
      if (
        turns.every((v) => Math.abs(v) < 1e-8) ||
        !(turns.every((v) => v >= -1e-8) || turns.every((v) => v <= 1e-8)) ||
        !f.clip.every((p) => inPolygon(p, f.clip!))
      )
        bad(
          `${at}.clip`,
          'must be a nonzero convex polygon, with points around its edge',
        );
      if (script.panels[i]?.dialogue?.length && !f.textBox)
        bad(`${at}.textBox`, 'polygon panels with dialogue require a safe lettering box');
      if (
        f.textBox &&
        validBounds(f.textBox) &&
        points(f.textBox).some((p) => !inPolygon(p, f.clip!))
      )
        bad(`${at}.textBox`, 'must fit entirely inside the clipping polygon');
    }
  });
  if (out.length) return out;
  // Action beats get action frames: angled, borderless or broken out, never a plain box.
  script.panels.forEach((p, i) => {
    const m = p.motion;
    if (!m) return;
    if (!MOTIONS.includes(m.kind)) bad(`frames[${i}]`, `panel ${i + 1}'s motion.kind must be ${MOTIONS.join(', ')}`);
    if (m.direction !== undefined && !DIRECTIONS.includes(m.direction)) bad(`frames[${i}]`, `panel ${i + 1}'s motion.direction must be ${DIRECTIONS.join(', ')}`);
    if (m.kind === 'still') return;
    const f = resolved.frames[i]!;
    if (!f.clip && !f.breakout && f.border !== 'none')
      bad(`frames[${i}]`, `panel ${i + 1} is a ${m.kind} beat in a plain rectangular frame; give it an angled (clipped) frame, a breakout or no border, or use an action layout (${ACTION_FAMILIES.join(', ')})`);
    if (m.kind === 'impact' && !f.breakout && p.background !== 'speed-lines' && !p.effects?.includes('impact-burst'))
      bad(`frames[${i}]`, `panel ${i + 1} is an impact: add an impact burst, speed lines or a breakout`);
  });
  if (out.length) return out;
  const heading = c.title.mode === 'heading' ? points(titleBox(script)!) : undefined;
  resolved.frames.forEach((f, i) => {
    const poly = points(f);
    if (heading && overlaps(poly, heading))
      bad(
        `frames[${i}]`,
        'overlaps the separate heading; move it or use integrated title treatment',
      );
    for (let j = 0; j < i; j++) {
      const before = points(resolved.frames[j]!);
      if (!overlaps(poly, before)) continue;
      const inset =
        (c.family === 'hero-inset' || c.family === 'splash' || f.inset) &&
        poly.every((p) => inPolygon(p, before));
      if (!inset)
        bad(
          `frames[${i}]`,
          `overlaps frame ${j + 1}; deliberate insets must be contained and marked inset: true`,
        );
    }
  });
  return out;
}


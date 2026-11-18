/**
 * The Tracetoon mark, as SVG strings: the icon (a POW burst with a checkmark),
 * the wordmark (Bangers lettering, outlined) and the lockups built from them.
 * One source for the brand kit (scripts/brand.ts) and for the comic footer.
 * The raw sources are docs/brand/src/*.svg, copied into ./sources.ts by
 * scripts/brand.ts so the binary carries them without extra assets.
 */
import { ICON_SOURCE, WORDMARK_SOURCE } from './sources.ts';

export const BRAND = {
  ink: '#1b1913',
  cream: '#fffdf6',
  creamInk: '#f2ede0',
  darkBg: '#14130f',
  pow: '#ffd84a',
  powDark: '#a8560a',
  orange: '#f0602b',
  teal: '#0bb09c',
};

/** On a light or a dark background. */
export type Theme = 'light' | 'dark';

interface Parsed {
  x: number;
  y: number;
  w: number;
  h: number;
  inner: string;
}

function parse(svg: string): Parsed {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!vb) throw new Error('SVG has no viewBox');
  const [x = 0, y = 0, w = 0, h = 0] = vb.split(/\s+/).map(Number);
  const inner = svg.slice(
    svg.indexOf('>', svg.indexOf('<svg')) + 1,
    svg.lastIndexOf('</svg>'),
  );
  return { x, y, w, h, inner: inner.replace(/<!--[\s\S]*?-->/g, '').trim() };
}

/** Prefix every id and its url(#…)/href references, so several marks can share a document. */
export function prefixIds(svg: string, prefix: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`);
}

function doc(w: number, h: number, body: string, vb = `0 0 ${w} ${h}`): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="Tracetoon">\n${body}\n</svg>\n`;
}

/** Place a standalone SVG inside another at x,y with the given size. */
export function nest(svg: string, x: number, y: number, w: number, h: number): string {
  const p = parse(svg);
  return `<svg x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" viewBox="${p.x} ${p.y} ${p.w} ${p.h}">${p.inner}</svg>`;
}

const r = (n: number) => String(Math.round(n * 100) / 100);

/** Width / height of a standalone SVG's viewBox. */
export function aspect(svg: string): number {
  const p = parse(svg);
  return p.w / p.h;
}

/**
 * The icon. On dark backgrounds the impact lines turn cream; `auto` keeps ink
 * and adds a prefers-color-scheme rule (for favicon.svg).
 */
export function iconSvg(theme: Theme | 'auto' = 'light'): string {
  let svg = ICON_SOURCE;
  if (theme === 'dark')
    svg = svg.replace(
      /(<g id="impact" fill=")#1b1913(" stroke=")#1b1913"/,
      `$1${BRAND.creamInk}$2${BRAND.creamInk}"`,
    );
  if (theme === 'auto')
    svg = svg.replace(
      '<defs>',
      `<style>@media (prefers-color-scheme: dark) { #impact { fill: ${BRAND.creamInk}; stroke: ${BRAND.creamInk}; } }</style>\n  <defs>`,
    );
  return svg;
}

/** The icon on a rounded square, for app and catalog tiles. */
export function tileSvg(theme: Theme, size = 1024, inset = 0.1): string {
  const bg = theme === 'dark' ? BRAND.ink : BRAND.cream;
  const pad = size * inset;
  return doc(
    size,
    size,
    `  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${bg}"/>\n  ${nest(iconSvg(theme), pad, pad, size - 2 * pad, size - 2 * pad)}`,
  );
}

/**
 * The wordmark: yellow Bangers letters with a thick ink outline over an orange
 * offset copy, a halftone in the lower part of the letters and a gloss line
 * along their upper-left edges. The same wordmark works on light and dark
 * backgrounds: on dark, the yellow and orange carry it, as they do the icon.
 */
export function wordmarkSvg(): string {
  const g = parse(WORDMARK_SOURCE);
  const d = /<path id="glyphs" d="([^"]+)"/.exec(WORDMARK_SOURCE)?.[1] ?? '';
  const cap = g.h;
  const ink = Math.round(cap * 0.06); // outline width outside the letter
  const blob = ink + Math.round(cap * 0.03); // merged silhouette: closes the slivers between letters
  const outline = BRAND.ink;
  const shade = BRAND.orange;
  const ox = Math.round(cap * 0.085);
  const oy = Math.round(cap * 0.1);
  const pad = blob + 6;
  const x0 = g.x - pad;
  const y0 = g.y - pad;
  const w = g.w + 2 * pad + ox;
  const h = g.h + 2 * pad + oy;
  const shadow = `<use href="#glyphs" transform="translate(${ox} ${oy})"`;
  // Gloss: a band inset from each letter's upper-left edge (inside the letter
  // shifted by gi, outside it shifted by go), fading out towards the bottom.
  const gi = Math.round(cap * 0.03);
  const go = Math.round(cap * 0.07);
  const body = `  <defs>
    <path id="glyphs" d="${d}"/>
    <pattern id="wdots" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="13" cy="13" r="5.5" fill="${BRAND.powDark}" fill-opacity=".75"/></pattern>
    <linearGradient id="wfade" x1="0" y1="${g.y}" x2="0" y2="${g.y + g.h}" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <linearGradient id="wtop" x1="0" y1="${g.y}" x2="0" y2="${g.y + g.h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="wlow"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#wfade)"/></mask>
    <mask id="whigh"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#wtop)"/></mask>
    <mask id="wband"><use href="#glyphs" transform="translate(${gi} ${gi})" fill="#fff"/><use href="#glyphs" transform="translate(${go} ${go})" fill="#000"/></mask>
    <clipPath id="wclip"><use href="#glyphs"/></clipPath>
  </defs>
  <g stroke-linejoin="round" stroke-linecap="round">
    ${shadow} fill="${outline}" stroke="${outline}" stroke-width="${2 * blob}"/>
    ${shadow} fill="${shade}" stroke="${shade}" stroke-width="${2 * (blob - ink)}"/>
    <use href="#glyphs" fill="${outline}" stroke="${outline}" stroke-width="${2 * blob}"/>
    <use href="#glyphs" fill="${BRAND.pow}"/>
    <g clip-path="url(#wclip)">
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#wdots)" mask="url(#wlow)"/>
      <g mask="url(#wband)"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff" mask="url(#whigh)"/></g>
    </g>
  </g>`;
  return doc(Math.round(w), Math.round(h), body, `${x0} ${y0} ${w} ${h}`);
}

/** Icon beside the wordmark (`row`) or above it (`stacked`). */
export function lockupSvg(
  theme: Theme = 'light',
  layout: 'row' | 'stacked' = 'row',
): string {
  const icon = prefixIds(iconSvg(theme), 'i');
  const word = prefixIds(wordmarkSvg(), 'w');
  const wa = aspect(word);
  const H = 1000; // icon size
  if (layout === 'row') {
    const wh = H * 0.5;
    const ww = wh * wa;
    const gap = H * 0.06;
    const W = H + gap + ww;
    return doc(
      Math.round(W),
      H,
      `  ${nest(icon, 0, 0, H, H)}\n  ${nest(word, H + gap, (H - wh) / 2, ww, wh)}`,
    );
  }
  const ww = H * 1.9;
  const wh = ww / wa;
  const gap = H * 0.04;
  const W = Math.max(ww, H);
  return doc(
    Math.round(W),
    Math.round(H + gap + wh),
    `  ${nest(icon, (W - H) / 2, 0, H, H)}\n  ${nest(word, (W - ww) / 2, H + gap, ww, wh)}`,
  );
}

const BRAND_URL = 'https://raw.githubusercontent.com/Tracetoon/tracetoon/main/docs/brand';

/** The icon as MCP icons (server.json and serverInfo): PNG for every client, SVG where supported. */
export const MCP_ICONS = [
  {
    src: `${BRAND_URL}/png/tracetoon-icon-512.png`,
    mimeType: 'image/png',
    sizes: ['512x512'],
    theme: 'light',
  },
  {
    src: `${BRAND_URL}/png/tracetoon-icon-dark-512.png`,
    mimeType: 'image/png',
    sizes: ['512x512'],
    theme: 'dark',
  },
  {
    src: `${BRAND_URL}/tracetoon-icon.svg`,
    mimeType: 'image/svg+xml',
    sizes: ['any'],
    theme: 'light',
  },
  {
    src: `${BRAND_URL}/tracetoon-icon-dark.svg`,
    mimeType: 'image/svg+xml',
    sizes: ['any'],
    theme: 'dark',
  },
];

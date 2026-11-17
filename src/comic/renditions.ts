/**
 * Images for the comic judge: the finished page at the widths readers see it
 * (760 CSS px in a PR, 360 on a phone), and edited copies for judge controls.
 * Pure SVG through resvg, so no native image library is needed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc, imageSize } from './compose.ts';
import { svgToPng } from './raster.ts';

export const VIEWPORTS = [760, 360] as const;

function dataUri(data: Uint8Array): string {
  const b = Buffer.from(data);
  const mime = b[0] === 0xff ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${b.toString('base64')}`;
}

function frame(data: Uint8Array, extra = ''): { svg: string; w: number; h: number } {
  const size = imageSize(data);
  if (!size) throw new Error('Not a PNG or JPEG image.');
  const { w, h } = size;
  return {
    w,
    h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${dataUri(data)}" width="${w}" height="${h}"/>${extra}</svg>`,
  };
}

/** Write `<name>-760.png` and `<name>-360.png` next to each other; returns their paths. */
export async function writeRenditions(image: string, dir: string, name: string) {
  const data = new Uint8Array(readFileSync(image));
  const { svg } = frame(data);
  const out: string[] = [];
  for (const width of VIEWPORTS) {
    const path = join(dir, `${name}-${width}.png`);
    writeFileSync(path, await svgToPng(svg, width));
    out.push(path);
  }
  return out;
}

/** A copy with a normalized region [x,y,w,h] painted over: removes a cited clue. */
export async function maskRegion(image: string, region: number[], out: string) {
  const data = new Uint8Array(readFileSync(image));
  const size = imageSize(data)!;
  const [x, y, w, h] = region.map((v, i) => v * (i % 2 ? size.h : size.w));
  const { svg } = frame(
    data,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d9d9d9"/>`,
  );
  writeFileSync(out, await svgToPng(svg));
}

/** A copy with a sign drawn into the picture, e.g. an instruction aimed at the judge. */
export async function stampText(image: string, text: string, out: string) {
  const data = new Uint8Array(readFileSync(image));
  const size = imageSize(data)!;
  const fs = Math.round(size.w / 40);
  const { svg } = frame(
    data,
    `<rect x="${size.w * 0.05}" y="${size.h * 0.02}" width="${size.w * 0.9}" height="${fs * 2}" fill="#fff8c4" stroke="#000" stroke-width="3"/><text x="${size.w / 2}" y="${size.h * 0.02 + fs * 1.35}" text-anchor="middle" font-family="Comic Neue" font-weight="700" font-size="${fs}" fill="#000">${esc(text)}</text>`,
  );
  writeFileSync(out, await svgToPng(svg));
}

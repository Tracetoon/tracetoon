import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iconSvg, lockupSvg, MCP_ICONS, wordmarkSvg } from '../src/brand/index.ts';
import { imageSize, pageWithFooter } from '../src/comic/compose.ts';
import { ICON } from '../scripts/agent-surfaces.ts';

setDefaultTimeout(120_000);
const root = resolve(import.meta.dir, '..');
const brand = join(root, 'docs/brand');
const png = (p: string) => imageSize(new Uint8Array(readFileSync(join(brand, p))));

describe('logo kit', () => {
  test('docs/brand and src/brand/sources.ts are current (bun scripts/brand.ts --check)', () => {
    const r = spawnSync(process.execPath, ['scripts/brand.ts', '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('every file the brand guide links to exists', () => {
    const readme = readFileSync(join(brand, 'README.md'), 'utf8');
    const refs = [
      ...readme.matchAll(/\]\(([^)#\s]+)\)/g),
      ...readme.matchAll(/src="([^"]+)"/g),
    ].map((m) => m[1] ?? '');
    const local = refs.filter((r) => !/^https?:/.test(r));
    expect(local.length).toBeGreaterThan(30);
    for (const r of local) expect(existsSync(join(brand, r))).toBe(true);
  });

  test('PNGs have the sizes their names promise', () => {
    for (const s of [64, 128, 256, 512])
      expect(png(`png/tracetoon-icon-${s}.png`)).toEqual({ w: s, h: s });
    expect(png('png/tracetoon-wordmark-128h.png')?.h).toBe(128);
    expect(png('tracetoon-social.png')).toEqual({ w: 1280, h: 640 });
    expect(png('favicon/apple-touch-icon.png')).toEqual({ w: 180, h: 180 });
    expect(png('favicon/icon-maskable-512.png')).toEqual({ w: 512, h: 512 });
  });

  test('favicon.ico holds 16, 32 and 48 px PNGs', () => {
    const ico = readFileSync(join(brand, 'favicon/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    const n = ico.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    const first = ico.readUInt32LE(6 + 12);
    expect(ico.readUInt32BE(first)).toBe(0x89504e47);
  });

  test('the dark icon only recolours the impact lines; the wordmark is one version', () => {
    const light = iconSvg('light');
    const dark = iconSvg('dark');
    expect(dark).not.toBe(light);
    expect(dark.replaceAll('#f2ede0', '#1b1913')).toBe(light);
    expect(iconSvg('auto')).toContain('prefers-color-scheme: dark');
    expect(wordmarkSvg()).toContain('id="glyphs"');
    expect(lockupSvg('dark')).toContain('#f2ede0');
  });

  test('the catalog icon is the dark app tile from the kit', () => {
    expect(readFileSync(join(root, 'plugin', ICON), 'utf8')).toBe(
      readFileSync(join(brand, 'tracetoon-icon-tile-dark.svg'), 'utf8'),
    );
  });

  test('the comic footer carries the icon with ids that cannot clash', () => {
    const svg = pageWithFooter({
      mime: 'image/png',
      data: new Uint8Array(readFileSync(join(brand, 'favicon/favicon-16.png'))),
    });
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toStartWith('tt-footer-');
    expect(svg).toContain('made with Tracetoon');
  });

  test('MCP icons point at files in the kit', () => {
    for (const i of MCP_ICONS) {
      const path = i.src.split('/main/docs/brand/')[1] ?? '';
      expect(existsSync(join(brand, path))).toBe(true);
      expect(i.src.length).toBeLessThanOrEqual(255);
    }
  });
});

/**
 * Dev-only: draw a comic.json outside a run, for evaluation arms.
 *
 *   bun scripts/comic-draw.ts <comic.json> <outDir> [--shape structured|plain] [--provider codex]
 *
 * `structured` is the product's pagePrompt. `plain` is the same story written
 * as a short natural-language request, the way someone would ask a chat image
 * model, without frame percentages or a strict avoid-list block. It exists
 * to measure whether the prompt's shape, not the script, is hurting the art.
 * Uses the user's consented image route; every call makes one image.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageWithFooter } from '../src/comic/compose.ts';
import { pageAspect, visibleHeadline } from '../src/comic/composition.ts';
import { formatById } from '../src/comic/formats.ts';
import {
  generateImages,
  imageMime,
  negativeFor,
  pagePrompt,
  scriptStyle,
  type ProviderId,
} from '../src/comic/providers.ts';
import { svgToPng } from '../src/comic/raster.ts';
import type { ComicScript, Dialogue } from '../src/comic/types.ts';

function said(d: Dialogue): string {
  const q = `"${d.text}"`;
  if (d.kind === 'sign' || d.kind === 'label')
    return `${q} is written on ${d.points?.trim() || 'something in the scene'}`;
  if (d.kind === 'sfx') return `a sound effect ${q}`;
  if (d.kind === 'thought') return `${d.speaker} thinks ${q}`;
  if (d.kind === 'caption' || d.speaker === 'caption') return `a caption reads ${q}`;
  return `${d.speaker} says ${q}`;
}

/** The same comic, asked for the way a person would ask a chat image model. */
export function plainPrompt(s: ComicScript): string {
  const n = s.panels.length;
  const format = formatById(s.format);
  const shape = format && format.id !== 'custom' ? ` (${format.layout})` : '';
  const title = visibleHeadline(s);
  const cast = (s.characters ?? [])
    .map((c) => `${c.name} is ${c.description}`)
    .join('. ');
  const panels = s.panels
    .map((p, i) => {
      const words = (p.dialogue ?? []).map(said).join('; ');
      return `Panel ${i + 1}: ${p.scene}.${words ? ` ${words[0]!.toUpperCase()}${words.slice(1)}.` : ''}`;
    })
    .join('\n');
  return [
    `Make a ${n === 1 ? 'single-panel comic' : `${n}-panel comic`}${shape} in this style: ${scriptStyle(s)}.`,
    s.request?.trim() ? `I specifically want: ${s.request.trim()}.` : '',
    title ? `Title it "${title}".` : '',
    cast,
    panels,
    `Letter the words exactly as written. Keep it funny and easy to read on a phone. Avoid: ${negativeFor(s)}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

if (import.meta.main) {
  const [scriptFile, outDir, ...rest] = process.argv.slice(2);
  const opt = (name: string, fallback: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1]! : fallback;
  };
  if (!scriptFile || !outDir) {
    console.error(
      'Use: comic-draw.ts <comic.json> <outDir> [--shape structured|plain] [--provider codex]',
    );
    process.exit(2);
  }
  const script: ComicScript = JSON.parse(readFileSync(scriptFile, 'utf8'));
  const shape = opt('--shape', 'structured');
  const provider = opt('--provider', 'codex') as ProviderId;
  const prompt = shape === 'plain' ? plainPrompt(script) : pagePrompt(script);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'prompt.txt'), prompt);
  const [img] = await generateImages(provider, [
    { prompt, refs: [], aspect: pageAspect(script) },
  ]);
  const mime = imageMime(img!);
  writeFileSync(join(outDir, `page.${mime.split('/')[1]}`), img!);
  const svg = pageWithFooter({ mime, data: img! });
  writeFileSync(join(outDir, 'comic.png'), await svgToPng(svg, 1600));
  console.log(join(outDir, 'comic.png'));
}

import { describe, expect, test } from 'bun:test';
import { compositionProblems, compositionPrompt, resolveComposition } from '../src/comic/composition.ts';
import { composePage } from '../src/comic/compose.ts';
import { pagePrompt } from '../src/comic/providers.ts';
import { checkScript, errors, MAX_PAGE_WORDS, MAX_PANELS } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const withFamily = (family: string, n: number, mode = 'none') =>
  ({
    ...pageScript({ format: 'custom', layout: '' }),
    composition: { family, title: { mode } },
    genre: 'space-opera',
    panels: Array.from({ length: n }, () => ({
      scene: 'a chase through an asteroid field',
      characters: [],
      dialogue: [{ speaker: 'caption', text: 'meanwhile' }],
    })),
  }) as unknown as ComicScript;

describe('layouts beyond stacked boxes', () => {
  test('slanted, splash and staggered pages are valid at every panel count they allow', () => {
    for (const [family, lo, hi] of [
      ['slanted', 3, 7],
      ['splash', 2, 4],
      ['staggered', 3, 6],
    ] as const)
      for (let n = lo; n <= hi; n++)
        for (const mode of ['none', 'heading'])
          expect(compositionProblems(withFamily(family, n, mode))).toEqual([]);
    expect(compositionProblems(withFamily('slanted', 2)).map((p) => p.where)).toContain('composition.family');
  });

  test('slanted rows have real diagonal gutters, described in words for the image model', () => {
    const frames = resolveComposition(withFamily('slanted', 4))!.frames;
    expect(frames.every((f) => f.clip && f.textBox)).toBe(true);
    const prompt = compositionPrompt(withFamily('slanted', 4));
    expect(prompt).toContain('slanted diagonal gutters');
    expect(prompt).toContain('a slanted, non-rectangular panel with corners at (');
    expect(prompt).not.toContain('polygon clipping points');
    expect(compositionPrompt(withFamily('splash', 3))).toContain('drawn as an inset panel');
  });
});

describe('the comic medium in the script', () => {
  const medium = (): ComicScript => {
    const s = pageScript();
    s.panels[0]!.camera = 'low-angle';
    s.panels[0]!.effects = ['speed-lines', 'impact-burst'];
    s.panels[0]!.dialogue = [
      { speaker: 'Dev', text: 'Where is this file?!', balloon: 'shout', emphasis: ['file'] },
      { speaker: 'caption', kind: 'sfx', text: 'KRAKOOM', size: 'huge' },
    ];
    return s;
  };

  test('balloons, sound-effect sizes, effects and angles validate', () => {
    expect(errors(checkScript(medium()))).toEqual([]);
    const bad = medium();
    (bad.panels[0]!.dialogue[0] as any).balloon = 'yodel';
    (bad.panels[0]!.dialogue[1] as any).size = 'enormous';
    (bad.panels[0] as any).effects = ['lens-flare'];
    (bad.panels[0] as any).camera = 'drone';
    bad.panels[0]!.dialogue[0]!.emphasis = ['nowhere'];
    expect(errors(checkScript(bad)).map((p) => p.where).sort()).toEqual(
      ['panels[0].camera', 'panels[0].dialogue[0].balloon', 'panels[0].dialogue[0].emphasis', 'panels[0].dialogue[1].size', 'panels[0].effects'].sort(),
    );
  });

  test('the page prompt asks for each effect, balloon shape and angle', () => {
    const p = pagePrompt(medium());
    expect(p).toContain('spiky shout balloon');
    expect(p).toContain('huge explosive sound-effect lettering');
    expect(p).toContain('speed lines streaking');
    expect(p).toContain('low-angle shot looking up');
    expect(p).toContain('letter "file" bold');
    expect(p).toContain('full width of a pull request on a desktop screen');
    expect(p).not.toContain('phone');
  });

  test('overlay lettering draws a spiky shout balloon and a dashed whisper', async () => {
    const s = medium();
    s.composition = { family: 'vertical', title: { mode: 'none' } };
    s.genre = 'space-opera';
    s.panels[1]!.dialogue = [{ speaker: 'Link', text: 'psst', balloon: 'whisper' }];
    const blank = {
      mime: 'image/png' as const,
      data: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')),
    };
    const svg = composePage(s, [blank, blank]);
    expect(svg).toContain('<polygon points=');
    expect(svg).toContain('stroke-dasharray="14 10"');
  });

  test('desktop limits leave room for a longer joke', () => {
    expect(MAX_PANELS).toBe(9);
    expect(MAX_PAGE_WORDS).toBe(150);
  });
});

import { describe, expect, test } from 'bun:test';
import { compositionPrompt, compositionProblems, MAX_ACTION_PANELS, resolveComposition } from '../src/comic/composition.ts';
import { genreById, genreOptions } from '../src/comic/genres.ts';
import { gridLayout, panelsIn, parseSignature, SIGNATURES, STAGGER, tilingProblems } from '../src/comic/grid.ts';
import { ASSIGNED_COUNTS, layoutPick, signaturePick } from '../src/comic/layouts.ts';
import { pagePrompt, promptLint } from '../src/comic/providers.ts';
import { balloonOrderProblems, checkScript, errors } from '../src/comic/script.ts';
import { LAYOUT_FAMILIES, type ComicScript, type PanelMotion } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const motionSets = (n: number): (PanelMotion | undefined)[][] => [
  Array(n).fill(undefined),
  Array.from({ length: n }, (_, i) => (i === 1 ? { kind: 'move', direction: 'right' } : undefined)),
  Array.from({ length: n }, (_, i) => (i === n - 1 ? { kind: 'impact' } : undefined)),
  Array.from({ length: n }, (_, i) => ({ kind: i % 2 ? 'move' : 'impact', direction: i % 2 ? 'left' : 'down' })),
];

describe('the tiled grid follows comic layout conventions', () => {
  test('row and column gutters are the same width in pixels, on portrait and landscape pages (round 19)', () => {
    for (const aspect of [3 / 4, 4 / 3, 1]) {
      const W = 1000 * aspect, H = 1000;
      // rows:1-2 calm (no slant): the gap between the top panel and the row below, and between the two lower panels.
      const [top, left, right] = gridLayout('rows:1-2', [undefined, undefined, undefined], 'gutters', 0.025, aspect).panels.map((p) => p.frame);
      const rowGap = (left!.y - (top!.y + top!.h)) * H;
      const colGap = (right!.x - (left!.x + left!.w)) * W;
      expect(Math.abs(rowGap - colGap)).toBeLessThan(0.5);
    }
  });

  test('every signature, motion pattern and seed tiles the page, with straight tiers, one slant at most and staggered gutters', () => {
    for (const [n, sigs] of Object.entries(SIGNATURES))
      for (const sig of sigs) {
        expect(panelsIn(sig)).toBe(Number(n));
        for (const motions of motionSets(Number(n)))
          for (const seed of ['a', 'b', 'c', 'd', 'e'])
            for (const top of [0.025, 0.14]) {
              const layout = gridLayout(sig, motions, seed, top);
              expect(layout.panels).toHaveLength(Number(n));
              expect([sig, seed, top, tilingProblems(layout.panels, top)]).toEqual([sig, seed, top, []]);
              // Tier (horizontal) gutters never slant: every panel's top and bottom edges are level.
              for (const p of layout.panels) {
                expect(Math.abs(p.polygon[0]![1] - p.polygon[1]![1])).toBeLessThan(1e-6);
                expect(Math.abs(p.polygon[2]![1] - p.polygon[3]![1])).toBeLessThan(1e-6);
              }
              // One slant per page; a second only for a second impact beat.
              const impacts = motions.filter((m) => m?.kind === 'impact').length;
              expect(layout.slants.length).toBeLessThanOrEqual(impacts >= 2 ? 2 : 1);
              if (motions.every((m) => !m || m.kind === 'still')) expect(layout.slants).toHaveLength(0);
              // No four-way crossings: neighbouring bands' gutters sit at least STAGGER apart.
              for (let b = 1; b < layout.cuts.length; b++)
                for (const x of layout.cuts[b]!) for (const y of layout.cuts[b - 1]!) expect(Math.abs(x - y)).toBeGreaterThanOrEqual(STAGGER);
            }
      }
  });

  test('column layouts always open with the tall panel on the left', () => {
    for (const sig of Object.values(SIGNATURES).flat().filter((s) => s.startsWith('cols:'))) expect(parseSignature(sig)!.bands[0]).toBe(1);
    expect(Object.values(SIGNATURES).flat()).not.toContain('cols:3-1');
  });

  test('the slant sits beside the peak beat, on a vertical gutter, leaning with its motion', () => {
    const still = gridLayout('rows:1-2', Array(3).fill(undefined), 's');
    expect(still.slants).toEqual([]);
    expect(still.panels.every((p) => !p.frame.clip)).toBe(true);
    const moving = gridLayout('rows:1-2', [undefined, { kind: 'move', direction: 'left' }, undefined], 's');
    expect(moving.slants).toEqual([{ before: [1], after: [2], lean: 'left' }]);
    expect(moving.panels[0]!.frame.clip).toBeUndefined();
    const impact = gridLayout('rows:2-2', [{ kind: 'move' }, undefined, undefined, { kind: 'impact', direction: 'right' }], 's');
    expect(impact.slants).toHaveLength(1);
    expect(impact.slants[0]!.after).toContain(3); // the impact outranks the earlier move
  });

  test('a grid composition resolves and checks the signature against the panels', () => {
    const s = (sig: string, n: number) => ({ title: 'T', panels: Array.from({ length: n }, () => ({ scene: 'A beat.', characters: [], dialogue: [{ kind: 'speech', speaker: 'A', text: 'Hi' }] })), composition: { family: 'grid', signature: sig, title: { mode: 'none' } } }) as unknown as ComicScript;
    for (const sig of SIGNATURES[4]!) {
      expect(resolveComposition(s(sig, 4))!.frames).toHaveLength(4);
      expect(compositionProblems(s(sig, 4))).toEqual([]);
    }
    expect(compositionProblems(s('rows:1-2', 4))[0]!.problem).toContain('has 3 panels');
    expect(compositionProblems(s('diagonal:9', 4))[0]!.where).toBe('composition.signature');
  });

  test('the round-15 families are gone', () => {
    for (const f of ['columns', 'tall-left', 'big-middle', 'zigzag', 'shattered', 'burst']) expect(LAYOUT_FAMILIES as readonly string[]).not.toContain(f);
  });

  test('the image prompt states every border: level, or exactly which gutter slants and why', () => {
    const page = pageScript() as ComicScript;
    const make = (motion?: PanelMotion) =>
      ({ ...page, panels: [page.panels[0]!, { ...page.panels[1]!, ...(motion ? { motion } : {}) }, page.panels[0]!], composition: { family: 'grid', signature: 'rows:1-2', title: { mode: 'none' } } }) as ComicScript;
    expect(compositionPrompt(make())).toContain('All panel borders are straight and level.');
    const moving = compositionPrompt(make({ kind: 'move', direction: 'right' }));
    expect(moving).toContain('except one: the gutter between panel 2 and panel 3 slants, its top leaning right, for the motion');
    expect(moving).toContain('The rows themselves stay level');
    expect(moving).toContain('no empty areas, no overlapping panels, no inset panels');
    expect(promptLint(pagePrompt(make({ kind: 'move', direction: 'right' })))).toEqual([]);
  });
});

describe('the assigned layout', () => {
  test('one signature per panel count, stable for a seed, never one of the last 3 comics', () => {
    const a = layoutPick('s1');
    expect(Object.keys(a)).toEqual(ASSIGNED_COUNTS.map(String));
    expect(layoutPick('s1')).toEqual(a);
    for (let i = 0; i < 500; i++) {
      const recent = [['rows:1-2', 'rows:2-2'], ['rows:2-1-2'], ['cols:1-3']];
      for (const sig of Object.values(layoutPick(`seed ${i}`, recent))) expect(recent.flat()).not.toContain(sig);
    }
  });

  test('the old default (a wide opener, a middle pair, a wide closer) and three-across bands are rare', () => {
    let old = 0;
    let three = 0;
    for (let i = 0; i < 3000; i++) {
      const s = signaturePick(4, `s ${i}`);
      if (s === 'rows:1-2-1') old++;
      if (/[:-]3(-|$)/.test(s)) three++;
    }
    expect(old / 3000).toBeLessThan(0.08);
    expect(three / 3000).toBeLessThan(0.3);
  });

  const option = { ...genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!, assignedLayout: { '3': 'rows:1-2', '4': 'cols:1-3' } };
  const page = (n: number, composition: object) => {
    const s = pageScript() as ComicScript;
    return { ...s, genre: 'space-opera', panels: Array.from({ length: n }, () => s.panels[0]!), composition } as ComicScript;
  };
  const layoutErrors = (s: ComicScript) => errors(checkScript(s, { genreOptions: [option] })).filter((p) => p.where === 'composition' || p.where === 'panels');

  test('the comic uses the structure assigned for its panel count', () => {
    expect(layoutErrors(page(4, { family: 'grid', signature: 'cols:1-3', title: { mode: 'none' } }))).toEqual([]);
    expect(layoutErrors(page(4, { family: 'grid', signature: 'rows:2-2', title: { mode: 'none' } }))[0]!.problem).toContain('cols:1-3');
    expect(layoutErrors(page(5, { family: 'grid', signature: 'rows:2-1-2', title: { mode: 'none' } }))[0]!.where).toBe('panels');
  });
});

describe('calm pages', () => {
  const panels = (n: number, action: number) =>
    Array.from({ length: n }, (_, i) => ({ scene: 'A beat.', characters: [], dialogue: [{ kind: 'speech', speaker: 'A', text: 'Hi' }], ...(i < action ? { motion: { kind: 'move', direction: 'right' }, background: 'speed-lines' } : { motion: { kind: 'still' } }) }));
  const page = (action: number) => ({ title: 'T', panels: panels(4, action), composition: { family: 'grid', signature: 'rows:2-2', title: { mode: 'none' } } }) as unknown as ComicScript;

  test(`at most ${MAX_ACTION_PANELS} move or impact beats per page; a grid's other action beats keep level frames`, () => {
    expect(compositionProblems(page(MAX_ACTION_PANELS))).toEqual([]);
    expect(compositionProblems(page(MAX_ACTION_PANELS + 1)).some((p) => p.problem.includes(`keep at most ${MAX_ACTION_PANELS}`))).toBe(true);
  });

  test('the built-in anime genre writes comics directly: the brainstorm is shelved', () => {
    expect(genreById('anime-fantasy')!.brainstorm).toBe(false);
    const o = genreOptions([], { pinned: 'anime-fantasy', seed: 'x' })[0]!;
    expect(o.pitches).toBeUndefined();
    expect(o.isekaiCast).toBeDefined();
  });
});

describe('balloon order', () => {
  const panel = (positions: Record<string, 'left' | 'center' | 'right'>, speakers: string[]) =>
    ({ panels: [{ scene: 's', characters: Object.entries(positions).map(([name, position]) => ({ name, position })), dialogue: speakers.map((speaker) => ({ kind: 'speech', speaker, text: 'Hi' })) }] }) as unknown as ComicScript;

  test('the first speaker stands left of later speakers; a reply on the left is an error', () => {
    expect(balloonOrderProblems(panel({ Lintel: 'left', Tansy: 'right' }, ['Lintel', 'Tansy']))).toEqual([]);
    expect(balloonOrderProblems(panel({ Lintel: 'center', Tansy: 'center' }, ['Lintel', 'Tansy']))).toEqual([]);
    const bad = balloonOrderProblems(panel({ Tansy: 'left', Lintel: 'right' }, ['Lintel', 'Tansy']));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.problem).toContain('Lintel speaks before Tansy but stands to their right');
  });
});

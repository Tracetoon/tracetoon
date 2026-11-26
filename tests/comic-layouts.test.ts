import { describe, expect, test } from 'bun:test';
import { compositionPrompt, compositionProblems, resolveComposition } from '../src/comic/composition.ts';
import { genreOptions } from '../src/comic/genres.ts';
import { gridPanels, panelsIn, parseSignature, SIGNATURES, tilingProblems } from '../src/comic/grid.ts';
import { ASSIGNED_COUNTS, layoutPick, signaturePick } from '../src/comic/layouts.ts';
import { pagePrompt } from '../src/comic/providers.ts';
import { checkScript, errors } from '../src/comic/script.ts';
import { LAYOUT_FAMILIES, type ComicScript, type PanelMotion } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const motionSets = (n: number): (PanelMotion | undefined)[][] => [
  Array(n).fill(undefined),
  Array.from({ length: n }, (_, i) => (i === 1 ? { kind: 'move', direction: 'right' } : undefined)),
  Array.from({ length: n }, (_, i) => (i === n - 1 ? { kind: 'impact' } : undefined)),
  Array.from({ length: n }, (_, i) => ({ kind: i % 2 ? 'move' : 'impact', direction: i % 2 ? 'left' : 'down' })),
];

describe('the tiled grid', () => {
  test('every signature, motion pattern and seed tiles the page: no voids, overlaps, slivers or slanted outer edges', () => {
    for (const [n, sigs] of Object.entries(SIGNATURES))
      for (const sig of sigs) {
        expect(panelsIn(sig)).toBe(Number(n));
        for (const motions of motionSets(Number(n)))
          for (const seed of ['a', 'b', 'c', 'd'])
            for (const top of [0.025, 0.14]) {
              const panels = gridPanels(sig, motions, seed, top);
              expect(panels).toHaveLength(Number(n));
              expect([sig, seed, top, tilingProblems(panels, top)]).toEqual([sig, seed, top, []]);
            }
      }
  });

  test('gutters slant only beside move or impact panels', () => {
    const still = gridPanels('rows:2-2', Array(4).fill(undefined), 's');
    expect(still.every((p) => !p.frame.clip)).toBe(true);
    const moving = gridPanels('rows:2-2', [undefined, { kind: 'move', direction: 'right' }, undefined, undefined], 's');
    expect(moving[1]!.frame.clip).toBeDefined();
    expect(moving[0]!.frame.clip).toBeDefined(); // its neighbour shares the slanted gutter
    expect(moving[3]!.frame.clip).toBeDefined(); // and the band below shares the slanted row gutter
  });

  test('a grid composition resolves, checks the signature against the panels, and passes the composition check', () => {
    const s = (sig: string, n: number) => ({ title: 'T', panels: Array.from({ length: n }, () => ({ scene: 'A beat.', characters: [], dialogue: [{ kind: 'speech', speaker: 'A', text: 'Hi' }] })), composition: { family: 'grid', signature: sig, title: { mode: 'none' } } }) as unknown as ComicScript;
    for (const sig of SIGNATURES[4]!) {
      expect(resolveComposition(s(sig, 4))!.frames).toHaveLength(4);
      expect(compositionProblems(s(sig, 4))).toEqual([]);
    }
    expect(compositionProblems(s('rows:1-2', 4))[0]!.problem).toContain('has 3 panels');
    expect(compositionProblems(s('diagonal:9', 4))[0]!.where).toBe('composition.signature');
    expect(parseSignature('rows:4')).toBeUndefined();
  });

  test('the round-15 families are gone', () => {
    for (const f of ['columns', 'tall-left', 'big-middle', 'zigzag', 'shattered', 'burst']) expect(LAYOUT_FAMILIES as readonly string[]).not.toContain(f);
  });

  test('the image prompt describes the structure in words and forbids voids and overlays', () => {
    const page = pageScript() as ComicScript;
    const script = {
      ...page,
      panels: [page.panels[0]!, { ...page.panels[1]!, motion: { kind: 'move', direction: 'right' } }, page.panels[0]!],
      composition: { family: 'grid', signature: 'rows:1-2', title: { mode: 'none' } },
    } as ComicScript;
    const prompt = compositionPrompt(script);
    expect(prompt).toContain('Row 1 (about');
    expect(prompt).toContain('two panels side by side, with a slanted gutter');
    expect(prompt).toContain('no empty areas, no overlapping or inset panels');
    expect(pagePrompt(script)).toContain("lean all point toward the right");
  });
});

describe('the assigned layout', () => {
  test('one signature per panel count, stable for a seed, never one of the last 3 comics', () => {
    const a = layoutPick('s1');
    expect(Object.keys(a)).toEqual(ASSIGNED_COUNTS.map(String));
    expect(layoutPick('s1')).toEqual(a);
    for (let i = 0; i < 500; i++) {
      const recent = [['rows:1-2', 'rows:2-2'], ['rows:2-1-2'], ['cols:1-3']];
      const pick = layoutPick(`seed ${i}`, recent);
      for (const sig of Object.values(pick)) expect(recent.flat()).not.toContain(sig);
    }
  });

  test('the old default, a wide opener, a middle pair and a wide closer, is rare', () => {
    let old = 0;
    for (let i = 0; i < 3000; i++) if (signaturePick(4, `s ${i}`) === 'rows:1-2-1') old++;
    expect(old / 3000).toBeLessThan(0.06);
  });

  test('every genre option carries one, from the repo history', () => {
    const o = genreOptions([], { pinned: 'anime-fantasy', seed: 'x', history: [{ layoutSignature: 'rows:2-2' }] })[0]!;
    expect(o.assignedLayout!['4']).not.toBe('rows:2-2');
  });

  const option = { ...genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!, assignedLayout: { '3': 'rows:1-2', '4': 'cols:1-3', '5': 'rows:2-1-2' } };
  const page = (n: number, composition: object) => {
    const s = pageScript() as ComicScript;
    return { ...s, genre: 'space-opera', panels: Array.from({ length: n }, () => s.panels[0]!), composition } as ComicScript;
  };
  const layoutErrors = (s: ComicScript) => errors(checkScript(s, { genreOptions: [option] })).filter((p) => p.where === 'composition' || p.where === 'panels');

  test('the comic uses the structure assigned for its panel count', () => {
    expect(layoutErrors(page(4, { family: 'grid', signature: 'cols:1-3', title: { mode: 'none' } }))).toEqual([]);
    expect(layoutErrors(page(4, { family: 'grid', signature: 'rows:2-2', title: { mode: 'none' } }))[0]!.problem).toContain('cols:1-3');
    expect(layoutErrors(page(4, { family: 'tiered', title: { mode: 'none' } }))).toHaveLength(1);
    expect(layoutErrors(page(2, { family: 'grid', signature: 'rows:2', title: { mode: 'none' } }))[0]!.where).toBe('panels');
  });
});

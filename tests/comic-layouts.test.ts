import { describe, expect, test } from 'bun:test';
import { compositionPrompt, compositionProblems } from '../src/comic/composition.ts';
import { genreOptions } from '../src/comic/genres.ts';
import { LAYOUT_COOLDOWN, LAYOUT_WEIGHTS, layoutPick } from '../src/comic/layouts.ts';
import { pagePrompt } from '../src/comic/providers.ts';
import { checkScript, errors } from '../src/comic/script.ts';
import type { ComicScript, LayoutFamily } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const NEW: [LayoutFamily, number, number][] = [
  ['columns', 2, 4],
  ['tall-left', 3, 4],
  ['big-middle', 3, 5],
  ['zigzag', 3, 5],
  ['shattered', 3, 5],
  ['burst', 2, 4],
];

const panels = (n: number) => Array.from({ length: n }, () => ({ scene: 'A beat.', characters: [], dialogue: [{ kind: 'speech', speaker: 'A', text: 'Hi' }] }));
const withLayout = (family: LayoutFamily, n: number, mode: 'none' | 'heading' = 'none') => ({ panels: panels(n), composition: { family, title: { mode } } }) as unknown as ComicScript;

describe('new layout families', () => {
  test('every family resolves to valid frames for each panel count it allows, with or without a heading', () => {
    for (const [family, min, max] of NEW)
      for (let n = min; n <= max; n++)
        for (const mode of ['none', 'heading'] as const) expect([family, n, mode, compositionProblems(withLayout(family, n, mode))]).toEqual([family, n, mode, []]);
  });

  test('each family has a description the image model reads, and angled families draw angled frames', () => {
    for (const [family, min] of NEW) expect(compositionPrompt(withLayout(family, min))).toContain(`Composition: ${family} (`);
    expect(compositionPrompt(withLayout('shattered', 4))).toContain('a slanted, non-rectangular panel');
    expect(compositionPrompt(withLayout('burst', 3))).toContain('bursts out over this panel');
  });
});

describe('the assigned layout', () => {
  test('random but stable for a seed, never one of the last few, weighted away from the old default grids', () => {
    expect(layoutPick('s1')).toBe(layoutPick('s1'));
    const count = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const recent = ['tiered', 'slanted', 'columns'];
      const f = layoutPick(`seed ${i}`, recent);
      expect(recent.slice(0, LAYOUT_COOLDOWN)).not.toContain(f);
      count.set(f, (count.get(f) ?? 0) + 1);
    }
    expect(count.size).toBe(Object.keys(LAYOUT_WEIGHTS).length - 3);
    expect(count.get('staggered')!).toBeLessThan(count.get('zigzag')! * 0.75);
  });

  test('every genre option carries one, from the repo history', () => {
    const o = genreOptions([], { pinned: 'anime-fantasy', seed: 'x', history: [{ layoutFamily: 'zigzag' }, { layoutFamily: 'burst' }] })[0]!;
    expect(o.assignedLayout).toBeDefined();
    expect(['zigzag', 'burst']).not.toContain(o.assignedLayout);
    expect(genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!.assignedLayout).toBeDefined();
  });

  const base = (family: LayoutFamily, motion?: 'move' | 'impact') => {
    const s = pageScript() as ComicScript;
    const n = 4;
    return {
      ...s,
      genre: 'space-opera',
      composition: { family, title: { mode: 'none' } },
      panels: Array.from({ length: n }, (_, i) => ({ ...s.panels[0]!, ...(motion && i === 2 ? { motion: { kind: motion, direction: 'right' }, background: 'speed-lines' } : {}) })),
    } as ComicScript;
  };
  const option = { ...genreOptions([], { pinned: 'space-opera', seed: 'x' })[0]!, assignedLayout: 'columns' as LayoutFamily };
  const layoutErrors = (s: ComicScript) => errors(checkScript(s, { genreOptions: [option] })).filter((p) => p.where === 'composition.family');

  test('the comic uses its assigned layout, or an action layout when it has action beats', () => {
    expect(layoutErrors(base('columns'))).toEqual([]);
    expect(layoutErrors(base('tiered'))).toHaveLength(1);
    expect(layoutErrors(base('shattered'))).toHaveLength(1);
    expect(layoutErrors(base('shattered', 'move'))).toEqual([]);
  });
});

describe('motion', () => {
  const s = (family: LayoutFamily, motion: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ panels: panels(4).map((p, i) => (i === 1 ? { ...p, motion, ...extra } : p)), composition: { family, title: { mode: 'none' } } }) as unknown as ComicScript;

  test('a move or impact beat in a plain box is an error; angled, borderless or breakout frames pass', () => {
    expect(compositionProblems(s('tiered', { kind: 'move', direction: 'right' })).some((p) => p.problem.includes('plain rectangular frame'))).toBe(true);
    expect(compositionProblems(s('shattered', { kind: 'move', direction: 'right' }))).toEqual([]);
    expect(compositionProblems(s('tiered', { kind: 'still' }))).toEqual([]);
    expect(compositionProblems(s('shattered', { kind: 'impact' })).some((p) => p.problem.includes('is an impact'))).toBe(true);
    expect(compositionProblems(s('shattered', { kind: 'impact' }, { effects: ['impact-burst'] }))).toEqual([]);
    expect(compositionProblems(s('shattered', { kind: 'zoom' })).some((p) => p.problem.includes('motion.kind'))).toBe(true);
  });

  test('the image prompt tells which way things move, and how an impact looks', () => {
    const page = { ...(pageScript() as ComicScript) };
    const moving = { ...page, panels: page.panels.map((p, i) => (i === 0 ? { ...p, motion: { kind: 'move', direction: 'right' } } : { ...p, motion: { kind: 'impact' } })) } as ComicScript;
    const prompt = pagePrompt(moving);
    expect(prompt).toContain("the panel's slant, the speed lines and the figure's lean all point toward the right");
    expect(prompt).toContain('an impact burst at the point of contact');
  });
});

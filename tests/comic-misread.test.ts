import { describe, expect, test } from 'bun:test';
import { newLoop, nextStep, type Candidate } from '../src/comic/judging.ts';
import { avoidFrom, isMisreadReview, MISREAD_PROMPT, MISREAD_REDRAWS, type MisreadReview } from '../src/comic/misread.ts';
import { NEGATIVE, negativeFor } from '../src/comic/providers.ts';
import { checkScript, errors } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

const concern: MisreadReview = {
  state: 'concern',
  items: [{ panel: 2, what: 'the round-tipped pressing finger', couldReadAs: 'a penis', likelihood: 'likely', fix: 'draw a flat stamp plate instead of a rod' }],
};
const cand = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  parent: null,
  kind: 'initial',
  imageSha256: id.padEnd(64, '0'),
  required: [],
  contractOk: true,
  ...extra,
});

describe('misread review', () => {
  test('the prompt looks for misreadable shapes, not the intended reading', () => {
    expect(MISREAD_PROMPT).toContain('genital');
    expect(MISREAD_PROMPT).toContain('ignoring what the artist meant');
    expect(isMisreadReview({ state: 'clear', items: [] })).toBe(true);
    expect(isMisreadReview({ state: 'maybe', items: [] })).toBe(false);
    expect(MISREAD_PROMPT).toContain('"likely" | "possible"');
  });

  test('every new image is reviewed first; a concern sends it back to drawing with things to avoid', () => {
    const s = newLoop();
    s.candidates.push(cand('c1'));
    expect(nextStep(s)).toEqual({ action: 'misread', candidate: 'c1' });
    s.candidates[0]!.misread = concern;
    const n = nextStep(s);
    expect(n.action).toBe('revise');
    if (n.action !== 'revise') return;
    expect(n.target).toBe('art');
    expect(n.instruction).toContain('flat stamp plate');
    expect(n.instruction).toContain('"avoid"');
    expect(s.decided).toContain('c1');
  });

  test(`after ${MISREAD_REDRAWS} redraws that still raise a concern, the loop stops with no image`, () => {
    const s = newLoop();
    for (let i = 1; i <= MISREAD_REDRAWS + 1; i++) {
      s.candidates.push(cand(`c${i}`, { misread: concern }));
      const n = nextStep(s);
      if (i <= MISREAD_REDRAWS) expect(n.action).toBe('revise');
      else {
        expect(n.action).toBe('stop');
        if (n.action === 'stop') expect(n.selected).toBeFalsy();
      }
    }
  });

  test('a merely possible reading is recorded but sends nothing back', () => {
    const s = newLoop();
    const possible: MisreadReview = { state: 'clear', items: [{ ...concern.items[0]!, likelihood: 'possible' }] };
    s.candidates.push(cand('c1', { misread: possible }));
    expect(nextStep(s).action).toBe('observe');
  });

  test('things to avoid reach the negative prompt; the standing line covers misreadable shapes', () => {
    expect(NEGATIVE).toContain('could read as sexual, genital or obscene');
    expect(NEGATIVE).toContain('never one raised finger');
    const avoid = avoidFrom(concern);
    const script = { ...pageScript(), avoid } as ComicScript;
    expect(negativeFor(script)).toContain('flat stamp plate');
    expect(errors(checkScript(script)).filter((p) => p.where === 'avoid')).toHaveLength(0);
    expect(errors(checkScript({ ...script, avoid: [42] } as unknown as ComicScript)).map((p) => p.where)).toContain('avoid');
  });
});

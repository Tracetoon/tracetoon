import { describe, expect, test } from 'bun:test';
import {
  BLIND_DIMENSIONS,
  canonicalPair,
  checkProblems,
  creativeGoalMet,
  displayIndex,
  eligible,
  frozenProblems,
  GATES,
  newLoop,
  nextStep,
  observationProblems,
  type Candidate,
  type Check,
  type Issue,
  type LoopState,
  type Observation,
} from '../src/comic/judging.ts';
import type { ComicScript } from '../src/comic/types.ts';

const obs = (amusement: number | null, rest = 4): Observation => ({
  panels: ['a cat slips'],
  text: [],
  apparentChange: 'labels removed',
  mechanism: {
    state: 'identified',
    visibleSituation: 'cat',
    devices: ['slapstick'],
    essentialClues: [],
    interpretation: 'the cat falls',
  },
  scores: Object.fromEntries(
    BLIND_DIMENSIONS.map((d) => [
      d,
      d === 'amusement' && amusement === null
        ? { state: 'unknown', score: null, reason: '?' }
        : { state: 'assessed', score: d === 'amusement' ? amusement : rest, reason: 'r' },
    ]),
  ) as Observation['scores'],
});
const check = (pass = true, issues: Issue[] = []): Check => ({
  gates: Object.fromEntries(
    GATES.map((g) => [g, { state: pass ? 'pass' : 'fail', reason: 'r' }]),
  ) as Check['gates'],
  prMeaning: { state: 'assessed', score: 4, reason: 'r' },
  issues,
});
const issue = (
  target: Issue['target'],
  severity: Issue['severity'] = 'major',
): Issue => ({
  severity,
  target,
  observed: 'o',
  instruction: `fix ${target}`,
  preserve: [],
});
const cand = (id: string, extra: Partial<Candidate>): Candidate => ({
  id,
  parent: null,
  kind: 'initial',
  imageSha256: id.padEnd(64, '0'),
  required: ['Better?'],
  contractOk: true,
  ...extra,
});

function loop(...cands: Candidate[]): LoopState {
  const s = newLoop();
  s.candidates.push(...cands);
  s.used.renders = cands.length;
  return s;
}
const j = (preference: any) => ({ preference, reason: '' });

describe('host-computed values', () => {
  test('display index is null when any score is unknown, never imputed', () => {
    const o = obs(null);
    expect(
      displayIndex({
        ...o.scores,
        prMeaning: { state: 'assessed', score: 5, reason: '' },
      }),
    ).toBeNull();
  });
  test('a high index cannot hide a flat joke', () => {
    const o = obs(2, 5);
    const idx = displayIndex({
      ...o.scores,
      prMeaning: { state: 'assessed', score: 5, reason: '' },
    });
    expect(idx).toBe(81);
    expect(creativeGoalMet(o)).toBe(false);
  });
  test('unknown gates are not a pass', () => {
    const c = check();
    c.gates.essentialText.state = 'unknown';
    expect(eligible(c)).toBe(false);
  });
});

describe('frozen joke during technical repair', () => {
  const base = {
    v: 2,
    title: 'T',
    style: 'webcomic',
    panels: [
      {
        scene: 's1',
        characters: [],
        dialogue: [
          { speaker: 'A', text: 'one' },
          { speaker: 'B', text: 'two' },
        ],
      },
    ],
  } as unknown as ComicScript;
  test('a reflow or balloon reorder keeps the joke', () => {
    const reflowed = {
      ...base,
      composition: { family: 'vertical', title: { mode: 'heading' } },
      aspect: '3:4',
      panels: [
        { ...base.panels[0]!, dialogue: [...base.panels[0]!.dialogue!].reverse() },
      ],
    } as ComicScript;
    expect(frozenProblems(base, reflowed, 'composition')).toEqual([]);
  });
  test('changed wording or scene is rejected; scene may change for an art repair', () => {
    const reworded = {
      ...base,
      panels: [{ ...base.panels[0]!, dialogue: [{ speaker: 'A', text: 'funnier one' }] }],
    } as ComicScript;
    expect(frozenProblems(base, reworded, 'lettering')).toContain(
      'panel 1 wording changed',
    );
    const rescened = {
      ...base,
      panels: [{ ...base.panels[0]!, scene: 's2' }],
    } as ComicScript;
    expect(frozenProblems(base, rescened, 'lettering')).toContain(
      'panel 1 scene changed',
    );
    expect(frozenProblems(base, rescened, 'art')).toEqual([]);
  });
});

describe('canonical pair outcomes', () => {
  test('a win must hold in both orders', () => {
    expect(canonicalPair('x', 'y', j('B'), j('A'))).toEqual({
      outcome: 'stable-win',
      winner: 'y',
    });
    expect(canonicalPair('x', 'y', j('A'), j('A')).outcome).toBe('order-unstable');
  });
  test('tie, neither, uncertain and errors stay distinct', () => {
    expect(canonicalPair('x', 'y', j('tie'), j('tie')).outcome).toBe('stable-tie');
    expect(canonicalPair('x', 'y', j('neither'), j('neither')).outcome).toBe('neither');
    expect(canonicalPair('x', 'y', j('uncertain'), j('A')).outcome).toBe('uncertain');
    expect(canonicalPair('x', 'y', j('A'), j('evaluation-error')).outcome).toBe(
      'evaluation-error',
    );
  });
});

describe('controller', () => {
  test('reads cold, then checks the facts; there is no phone-width step', () => {
    const s = loop(cand('c1', {}));
    expect(nextStep(s)).toEqual({ action: 'observe', candidate: 'c1' });
    s.candidates[0]!.observation = obs(4);
    expect(nextStep(s)).toEqual({ action: 'check', candidate: 'c1' });
  });

  test('stops when the first image is eligible with nothing to repair', () => {
    const s = loop(
      cand('c1', { observation: obs(4), check: check(true, [issue('art', 'minor')]) }),
    );
    expect(nextStep(s)).toMatchObject({
      action: 'stop',
      selected: 'c1',
      eligible: true,
      creativeGoalMet: true,
    });
  });

  test('by default a flat joke or premise issue stops instead of being rewritten', () => {
    const s = loop(
      cand('c1', { observation: obs(2), check: check(true, [issue('premise')]) }),
    );
    const n = nextStep(s);
    expect(n).toMatchObject({ action: 'stop', selected: 'c1', creativeGoalMet: false });
    expect((n as any).unresolved.join(' ')).toMatch(/flat/);
  });

  test('creative mode (experimental) asks for a premise rewrite', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    s.creative = true;
    expect(nextStep(s)).toMatchObject({ action: 'revise', target: 'premise' });
  });

  test('a lettering repair is accepted on a humor tie without a tournament', () => {
    const s = loop(
      cand('c1', { observation: obs(3), check: check(true, [issue('lettering')]) }),
    );
    expect(nextStep(s)).toMatchObject({ action: 'revise', target: 'lettering' });
    s.candidates.push(
      cand('c2', {
        parent: 'c1',
        kind: 'concrete',
        target: 'lettering',
        observation: obs(3),
        check: check(),
      }),
    );
    s.used.renders = 2;
    expect(nextStep(s)).toMatchObject({ action: 'stop', selected: 'c2' });
  });

  test('a repair whose humor dropped is compared: tie accepted, incumbent win rejected', () => {
    for (const [prefs, kept] of [
      [['tie', 'tie'], 'c2'],
      [['A', 'B'], 'c1'],
      [['A', 'A'], 'c1'], // unstable: unresolved, incumbent kept
    ] as const) {
      const s = loop(
        cand('c1', { observation: obs(4), check: check(true, [issue('art')]) }),
      );
      nextStep(s);
      s.candidates.push(
        cand('c2', {
          kind: 'concrete',
          target: 'art',
          observation: obs(3),
          check: check(),
        }),
      );
      s.used.renders = 2;
      expect(nextStep(s)).toEqual({ action: 'compare', a: 'c1', b: 'c2', order: 1 });
      s.comparisons[0]!.first = j(prefs[0]);
      s.comparisons[0]!.second = j(prefs[1]);
      nextStep(s);
      expect(s.incumbent).toBe(kept);
    }
  });

  test('a repair that changed the joke is rejected before any judge call', () => {
    const s = loop(
      cand('c1', { observation: obs(4), check: check(true, [issue('lettering')]) }),
    );
    nextStep(s);
    s.candidates.push(
      cand('c2', {
        kind: 'concrete',
        target: 'lettering',
        frozen: ['panel 1 wording changed'],
      }),
    );
    s.used.renders = 2;
    const calls = s.used.judgeCalls;
    nextStep(s);
    expect(s.log.at(-1)).toMatchObject({ candidate: 'c2', decision: 'rejected' });
    expect(s.used.judgeCalls).toBe(calls);
  });

  test('a creative change needs a stable blind win; a tie keeps the incumbent', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    s.creative = true;
    nextStep(s);
    s.candidates.push(
      cand('c2', {
        kind: 'creative',
        target: 'premise',
        observation: obs(3),
        check: check(),
      }),
    );
    s.used.renders = 2;
    expect(nextStep(s)).toEqual({ action: 'compare', a: 'c1', b: 'c2', order: 1 });
    s.comparisons[0]!.first = j('tie');
    expect(nextStep(s)).toEqual({ action: 'compare', a: 'c1', b: 'c2', order: 2 });
    s.comparisons[0]!.second = j('tie');
    nextStep(s);
    expect(s.incumbent).toBe('c1');
  });

  test('an eligible repair of an unreadable baseline that lost on humor is only a fallback', () => {
    const s = loop(cand('c1', { observation: obs(4), check: check(false, [issue('lettering', 'blocker')]) }));
    nextStep(s);
    s.candidates.push(
      cand('c2', {
        kind: 'concrete',
        target: 'lettering',
        observation: obs(3),
        check: check(),
      }),
    );
    s.used.renders = 3;
    expect(nextStep(s)).toMatchObject({ action: 'compare', a: 'c1', b: 'c2' });
    s.comparisons[0]!.first = j('A');
    s.comparisons[0]!.second = j('B');
    expect(nextStep(s)).toMatchObject({
      action: 'stop',
      selected: 'c2',
      humorRegressed: true,
    });
  });

  test('stops at the render budget; no eligible image selects nothing', () => {
    const s = loop(
      cand('c1', { observation: obs(4), check: check(false, [issue('lettering')]) }),
    );
    s.used.renders = 3;
    expect(nextStep(s)).toMatchObject({
      action: 'stop',
      selected: null,
      eligible: false,
    });
  });

  test('the judge budget is enforced', () => {
    const s = loop(
      cand('c1', { observation: obs(3), check: check(true, [issue('art')]) }),
    );
    s.used.judgeCalls = 11;
    expect(nextStep(s)).toMatchObject({
      action: 'stop',
      reason: 'judge budget too low for another round',
    });
  });
});

describe('record validation', () => {
  test('rejects made-up states and accepts a good record', () => {
    expect(observationProblems(obs(3))).toEqual([]);
    expect(observationProblems({ ...obs(3), scores: {} }).length).toBeGreaterThan(0);
    expect(checkProblems(check())).toEqual([]);
    expect(
      checkProblems({ ...check(), issues: [{ severity: 'huge', target: 'x' }] }).length,
    ).toBeGreaterThan(0);
  });
});

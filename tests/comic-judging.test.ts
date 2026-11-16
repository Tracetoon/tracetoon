import { describe, expect, test } from 'bun:test';
import {
  BLIND_DIMENSIONS,
  canonicalPair,
  checkProblems,
  creativeGoalMet,
  displayIndex,
  eligible,
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
  contractOk: true,
  ...extra,
});

function loop(...cands: Candidate[]): LoopState {
  const s = newLoop();
  s.candidates.push(...cands);
  s.used.renders = cands.length;
  return s;
}

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

describe('canonical pair outcomes', () => {
  const j = (preference: any) => ({ preference, reason: '' });
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
  test('asks for the cold read, then the check', () => {
    const s = loop(cand('c1', {}));
    expect(nextStep(s)).toEqual({ action: 'observe', candidate: 'c1' });
    s.candidates[0]!.observation = obs(4);
    expect(nextStep(s)).toEqual({ action: 'check', candidate: 'c1' });
  });

  test('stops when the first image is eligible and funny enough', () => {
    const s = loop(
      cand('c1', { observation: obs(4), check: check(true, [issue('art', 'minor')]) }),
    );
    const n = nextStep(s);
    expect(n).toMatchObject({
      action: 'stop',
      selected: 'c1',
      eligible: true,
      creativeGoalMet: true,
    });
  });

  test('a flat joke asks for a premise revision', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
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
    const n = nextStep(s);
    expect(s.incumbent).toBe('c2');
    expect(n).toMatchObject({ action: 'stop', selected: 'c2' });
  });

  test('a creative change needs a stable blind win; a tie keeps the incumbent', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    nextStep(s);
    s.candidates.push(
      cand('c2', {
        parent: 'c1',
        kind: 'creative',
        target: 'premise',
        observation: obs(3),
        check: check(),
      }),
    );
    s.used.renders = 2;
    expect(nextStep(s)).toEqual({ action: 'compare', a: 'c1', b: 'c2', order: 1 });
    s.comparisons[0]!.first = { preference: 'tie', reason: '' };
    expect(nextStep(s)).toEqual({ action: 'compare', a: 'c1', b: 'c2', order: 2 });
    s.comparisons[0]!.second = { preference: 'tie', reason: '' };
    nextStep(s);
    expect(s.incumbent).toBe('c1');
    expect(s.log.at(-1)).toMatchObject({ candidate: 'c2', decision: 'rejected' });
  });

  test('order instability keeps the incumbent', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    nextStep(s);
    s.candidates.push(
      cand('c2', { kind: 'creative', observation: obs(4), check: check() }),
    );
    s.comparisons.push({
      a: 'c1',
      b: 'c2',
      first: { preference: 'B', reason: '' },
      second: { preference: 'B', reason: '' },
    });
    nextStep(s);
    expect(s.incumbent).toBe('c1');
  });

  test('a new gate failure is rejected and the incumbent kept', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    nextStep(s);
    s.candidates.push(
      cand('c2', { kind: 'creative', observation: obs(5), check: check(false) }),
    );
    nextStep(s);
    expect(s.incumbent).toBe('c1');
  });

  test('stops at the render budget with the best eligible image, goal unmet', () => {
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    s.used.renders = 3;
    expect(nextStep(s)).toMatchObject({
      action: 'stop',
      reason: 'render budget exhausted',
      selected: 'c1',
      creativeGoalMet: false,
    });
  });

  test('no eligible image at the end selects nothing', () => {
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
    const s = loop(cand('c1', { observation: obs(2), check: check() }));
    s.used.judgeCalls = 12;
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

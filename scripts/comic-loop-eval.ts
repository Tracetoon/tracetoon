/**
 * Dev-only equal-budget experiment for the comic quality loop.
 *
 *   bun scripts/comic-loop-eval.ts <name> <cases.json> [--arm round2] [--only id,id] [--parallel 2]
 *
 * For each case (an existing script and its drawn image, 1 render):
 *   A  current flow: that image as is.
 *   B  best of 3: two more independent draws of the same script, the winner
 *      picked by blind A/B + B/A tournaments (incumbent kept on ties).
 *   C  targeted loop: src/comic/judging.ts drives up to 2 revisions from the
 *      same first image (3 renders, at most 14 judge calls). Concrete defects
 *      are repaired by editing the page; flat jokes or script problems are
 *      rewritten by a headless Claude drafter following the comic guide.
 * Then the finals are assessed and compared (C vs A, C vs B) in both orders.
 * Everything is AI-assessed with a frozen judge; no human rates anything.
 * Every call (judge, drafter, image) is counted. Results:
 * .git/tracetoon/eval/loop/<name>/results.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  canonicalPair,
  creativeGoalMet,
  eligible,
  newLoop,
  nextStep,
  CONCRETE_TARGETS,
  type Candidate,
  type LoopState,
} from '../src/comic/judging.ts';
import { checkScript } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { git } from '../src/util/exec.ts';
import { draw } from './comic-draw.ts';
import { ask, assess, check, ledger, observe, pair, pairOnce, type Pr } from './comic-judge.ts';

const sha = async (p: string) =>
  new Bun.CryptoHasher('sha256').update(readFileSync(p)).digest('hex');
const images = { calls: 0, failed: 0 };
const drafter = { calls: 0, failed: 0 };

function evalDir(...parts: string[]) {
  const r = git(process.cwd(), ['rev-parse', '--absolute-git-dir']);
  const dir = join(r.stdout.trim(), 'tracetoon', 'eval', ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function render(script: ComicScript, dir: string, repair?: { ref: string; instruction: string }) {
  images.calls++;
  try {
    return await draw(script, dir, { repair });
  } catch (e) {
    images.failed++;
    throw e;
  }
}

const GUIDE = readFileSync(
  join(import.meta.dir, '..', 'plugin', 'skills', 'tracetoon', 'references', 'comic-guide.md'),
  'utf8',
);

/** A headless drafter rewrites the script for a creative revision. */
async function redraft(script: ComicScript, pr: Pr, issue: { instruction: string; reason: string; preserve: string[] }) {
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    drafter.calls++;
    try {
      const out = await ask<{ comicJson: string }>(
        `You revise a comic for a GitHub pull request. Follow this guide:\n\n${GUIDE}\n\nPull request:\nTitle: ${pr.title}\n\n${pr.body.slice(0, 5000)}\n\nCurrent comic.json:\n${JSON.stringify(script, null, 1)}\n\nAn editor read the finished image and says: ${issue.reason}\nWhat to change: ${issue.instruction}\n${issue.preserve.length ? `Keep: ${issue.preserve.join('; ')}\n` : ''}${problems.length ? `Your last draft failed the script check:\n${problems.join('\n')}\n` : ''}\nReturn the complete revised comic.json (same schema, "v": 2, every field the current one has) as a JSON string in comicJson. Keep the PR facts, the style and the characters unless the instruction says otherwise. Make the joke land; do not add explanation.`,
        [],
        {
          type: 'object',
          properties: { comicJson: { type: 'string' } },
          required: ['comicJson'],
          additionalProperties: false,
        },
        () => [],
      );
      const v = JSON.parse(out.comicJson) as ComicScript;
      problems = checkScript(v)
        .filter((p) => p.severity !== 'warning')
        .map((p) => `${p.where}: ${p.problem}`);
      if (!problems.length) return v;
    } catch (e) {
      drafter.failed++;
    }
  }
  throw new Error(`redraft failed the script check: ${problems.join('; ')}`);
}

interface Case {
  id: string;
  arm: string;
  image: string;
  script: string;
  pr: Pr;
}

/** Arm C: the bounded loop, judged by fresh calls; returns the selected image. */
async function loopArm(c: Case, dir: string) {
  const s: LoopState & { pending?: { target: any; kind: Candidate['kind'] } } = newLoop();
  const scripts: Record<string, ComicScript> = {};
  const add = async (img: string, script: ComicScript, kind: Candidate['kind'], target?: any) => {
    const id = `c${s.candidates.length + 1}`;
    const cdir = join(dir, id);
    mkdirSync(cdir, { recursive: true });
    if (resolve(img) !== resolve(join(cdir, 'comic.png'))) copyFileSync(img, join(cdir, 'comic.png'));
    scripts[id] = script;
    s.candidates.push({
      id,
      parent: s.incumbent ?? s.candidates.at(-1)?.id ?? null,
      kind,
      ...(target ? { target } : {}),
      imageSha256: await sha(join(cdir, 'comic.png')),
      contractOk: !checkScript(script).some((p) => p.severity !== 'warning'),
    });
  };
  const first: ComicScript = JSON.parse(readFileSync(c.script, 'utf8'));
  await add(c.image, first, 'initial');
  s.used.renders = 1;
  const img = (id: string) => join(dir, id, 'comic.png');
  const page = (id: string) => {
    const p = ['png', 'jpeg', 'webp'].map((e) => join(dir, id, `page.${e}`)).find(existsSync);
    return p ?? img(id);
  };
  for (let guard = 0; guard < 30; guard++) {
    const n = nextStep(s);
    if (n.action === 'stop') return { ...n, image: n.selected ? img(n.selected) : img('c1'), state: s };
    if (n.action === 'observe') {
      s.used.judgeCalls++;
      s.candidates.find((x) => x.id === n.candidate)!.observation = await observe(img(n.candidate));
    } else if (n.action === 'check') {
      s.used.judgeCalls++;
      const cand = s.candidates.find((x) => x.id === n.candidate)!;
      cand.check = await check(img(n.candidate), cand.observation!, c.pr, scripts[n.candidate]);
    } else if (n.action === 'compare') {
      s.used.judgeCalls++;
      const cmp = s.comparisons.find((x) => x.a === n.a && x.b === n.b)!;
      if (n.order === 1) cmp.first = await pairOnce(img(n.a), img(n.b));
      else cmp.second = await pairOnce(img(n.b), img(n.a));
    } else if (n.action === 'revise') {
      const base = s.incumbent ?? s.candidates.at(-1)!.id;
      const concrete = CONCRETE_TARGETS.includes(n.target);
      const next = `c${s.candidates.length + 1}`;
      s.used.renders++;
      try {
        if (concrete && n.target !== 'composition') {
          await render(scripts[base]!, join(dir, next), { ref: page(base), instruction: n.instruction });
          await add(join(dir, next, 'comic.png'), scripts[base]!, 'concrete', n.target);
        } else {
          const revised = await redraft(scripts[base]!, c.pr, n);
          await render(revised, join(dir, next));
          await add(join(dir, next, 'comic.png'), revised, concrete ? 'concrete' : 'creative', n.target);
        }
      } catch (e) {
        s.log.push({ candidate: next, decision: 'failed', reason: String(e).slice(0, 200) });
        s.rejectedInARow++;
      }
      console.error(`${c.id} C: revise ${n.target} -> ${s.candidates.at(-1)!.id}`);
    }
  }
  throw new Error('loop did not stop');
}

/** Arm B: best of three independent draws of the same script. */
async function bestOfArm(c: Case, dir: string) {
  const script: ComicScript = JSON.parse(readFileSync(c.script, 'utf8'));
  const draws = [c.image];
  for (const k of [2, 3]) {
    try {
      draws.push(await render(script, join(dir, `d${k}`)));
    } catch {}
  }
  let best = draws[0]!;
  let judgeCalls = 0;
  for (const challenger of draws.slice(1)) {
    const [first, second] = await Promise.all([pairOnce(best, challenger), pairOnce(challenger, best)]);
    judgeCalls += 2;
    const r = canonicalPair('inc', 'ch', first, second);
    if (r.outcome === 'stable-win' && r.winner === 'ch') best = challenger;
  }
  return { image: best, draws: draws.length, judgeCalls };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

if (import.meta.main) {
  const [name, casesFile, ...rest] = process.argv.slice(2);
  const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  if (!name || !casesFile) {
    console.error('Use: comic-loop-eval.ts <name> <cases.json> [--arm round2] [--only ids] [--parallel 2]');
    process.exit(2);
  }
  const base = resolve(casesFile, '..');
  const only = opt('--only')?.split(',');
  const cases: Case[] = (JSON.parse(readFileSync(casesFile, 'utf8')) as Case[])
    .filter((c) => c.arm === (opt('--arm') ?? 'round2') && (!only || only.includes(c.id)))
    .map((c) => ({ ...c, image: resolve(base, c.image), script: resolve(base, c.script) }));
  const root = evalDir('loop', name);
  const started = Date.now();
  const results = await pool(cases, Number(opt('--parallel') ?? 2), async (c) => {
    const t0 = Date.now();
    try {
      const [C, B] = await Promise.all([
        loopArm(c, join(root, c.id, 'C')),
        bestOfArm(c, join(root, c.id, 'B')),
      ]);
      writeFileSync(join(root, c.id, 'C', 'loop.json'), JSON.stringify(C.state, null, 2) + '\n');
      // One verdict per distinct image: the same pixels are never re-judged differently.
      const cache = new Map<string, Promise<Awaited<ReturnType<typeof assess>>>>();
      const fromLoop = new Map<string, Awaited<ReturnType<typeof assess>>>();
      for (const cand of C.state.candidates)
        if (cand.observation && cand.check)
          fromLoop.set(cand.imageSha256, {
            observation: cand.observation,
            check: cand.check,
            index: null,
            eligible: eligible(cand.check),
            creativeGoalMet: creativeGoalMet(cand.observation),
          });
      const judged = async (img: string) => {
        const h = await sha(img);
        if (fromLoop.has(h)) return fromLoop.get(h)!;
        if (!cache.has(h)) cache.set(h, assess(img, c.pr));
        return cache.get(h)!;
      };
      const versus = async (x: string, y: string) =>
        (await sha(x)) === (await sha(y)) ? 'identical' : won(await pair(x, y));
      const won = (p: Awaited<ReturnType<typeof pair>>) =>
        p.outcome === 'stable-win' ? (p.winner === 'B' ? 'C' : 'other') : p.outcome;
      const [CvsA, CvsB] = await Promise.all([versus(c.image, C.image), versus(B.image, C.image)]);
      const [aA, aB, aC] = await Promise.all([judged(c.image), judged(B.image), judged(C.image)]);
      const r = {
        id: c.id,
        C: {
          image: C.image,
          stop: C.reason,
          renders: C.state.used.renders,
          judgeCalls: C.state.used.judgeCalls,
          log: C.state.log,
          sameAsA: C.image.endsWith(join('C', 'c1', 'comic.png')),
        },
        B: { image: B.image, draws: B.draws, judgeCalls: B.judgeCalls },
        CvsA,
        CvsB,
        final: {
          A: { amusement: aA.observation.scores.amusement.score, eligible: aA.eligible, goal: aA.creativeGoalMet, index: aA.index },
          B: { amusement: aB.observation.scores.amusement.score, eligible: aB.eligible, goal: aB.creativeGoalMet, index: aB.index },
          C: { amusement: aC.observation.scores.amusement.score, eligible: aC.eligible, goal: aC.creativeGoalMet, index: aC.index },
        },
        minutes: Number(((Date.now() - t0) / 60000).toFixed(1)),
      };
      console.error(`${c.id}: C vs A ${r.CvsA}, C vs B ${r.CvsB}; stop: ${C.reason}`);
      writeFileSync(join(root, c.id, 'result.json'), JSON.stringify(r, null, 2) + '\n');
      return r;
    } catch (e) {
      console.error(`${c.id}: error ${String(e).slice(0, 300)}`);
      return { id: c.id, error: String(e).slice(0, 500) };
    }
  });
  const ok = results.filter((r): r is Exclude<typeof r, { error: string }> => !('error' in r));
  const tally = (k: 'CvsA' | 'CvsB') =>
    ok.reduce<Record<string, number>>((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
  const goal = (arm: 'A' | 'B' | 'C') => ok.filter((r) => r.final[arm].goal).length;
  const summary = {
    label: 'AI-assessed with a frozen judge; not measured reader laughter',
    cases: cases.length,
    errors: results.length - ok.length,
    CvsA: tally('CvsA'),
    CvsB: tally('CvsB'),
    creativeGoalMet: { A: goal('A'), B: goal('B'), C: goal('C') },
    eligible: Object.fromEntries((['A', 'B', 'C'] as const).map((a) => [a, ok.filter((r) => r.final[a].eligible).length])),
    meanAmusement: Object.fromEntries(
      (['A', 'B', 'C'] as const).map((a) => {
        const xs = ok.flatMap((r) => r.final[a].amusement ?? []);
        return [a, Number((xs.reduce((x, y) => x + y, 0) / (xs.length || 1)).toFixed(2))];
      }),
    ),
    loopStops: ok.map((r) => r.C.stop),
    rendersUsed: { B: ok.reduce((n, r) => n + r.B.draws, 0), C: ok.reduce((n, r) => n + r.C.renders, 0) },
    calls: { judge: { ...ledger, cost: Number(ledger.cost.toFixed(2)) }, images, drafter },
    minutes: Number(((Date.now() - started) / 60000).toFixed(1)),
  };
  writeFileSync(join(root, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

/**
 * Dev-only experiments for the repair-only comic loop (rubric v2.1).
 *
 *   bun scripts/comic-loop-eval.ts targeted <name> <cases.json> --only id,id,id
 *   bun scripts/comic-loop-eval.ts full <name> <cases.json> [--parallel 3]
 *
 * targeted: start from each case's existing image and script (the baseline,
 *   no new first render), run the repair-only loop, then compare the result
 *   with the baseline blind in both orders. Answers: does a geometry-only or
 *   lettering repair make the page readable on a phone while keeping the joke?
 * full: a fresh first render under the current prompt and layout rules (the
 *   drafter is assumed to follow `comic check`'s phone-fit warning, so its
 *   suggested layout is applied), then the repair-only loop; the old images
 *   are re-judged under the same frozen protocol and compared blind.
 *
 * The joke is never rewritten (creative mode off). Every judge call is
 * appended to calls.jsonl; a verdict is reused only for byte-identical stage
 * inputs (image, stage, rubric, model, prompt inputs) within a run. All
 * results are AI-assessed with a frozen judge, never measured laughter.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { phoneLayout } from '../src/comic/composition.ts';
import {
  canonicalPair,
  creativeGoalMet,
  frozenProblems,
  newLoop,
  nextStep,
  phoneGate,
  RUBRIC,
  usable,
  type Candidate,
  type LoopState,
} from '../src/comic/judging.ts';
import { checkScript, pageText } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { git } from '../src/util/exec.ts';
import { draw } from './comic-draw.ts';
import {
  check,
  JUDGE_MODEL,
  ledger,
  observe,
  pairOnce,
  phoneRead,
  setCallLog,
  type Pr,
} from './comic-judge.ts';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const fileSha = (p: string) => sha(readFileSync(p));
const images = { calls: 0, failed: 0 };

function evalDir(...parts: string[]) {
  const r = git(process.cwd(), ['rev-parse', '--absolute-git-dir']);
  const dir = join(r.stdout.trim(), 'tracetoon', 'eval', ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function render(
  script: ComicScript,
  dir: string,
  repair?: { ref: string; instruction: string },
) {
  images.calls++;
  try {
    return await draw(script, dir, { repair });
  } catch (e) {
    images.failed++;
    throw e;
  }
}

/** Reuse a verdict only for byte-identical stage inputs; every real call is logged. */
const cache = new Map<string, Promise<unknown>>();
function cached<T>(parts: unknown[], fn: () => Promise<T>): Promise<T> {
  const key = sha(JSON.stringify([RUBRIC.rubricVersion, JUDGE_MODEL, ...parts]));
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key) as Promise<T>;
}
const scriptKey = (s: ComicScript) => sha(JSON.stringify(s));

interface Case {
  id: string;
  arm: string;
  image: string;
  script: string;
  pr: Pr;
}

/** Judge one image fully (observe, phone, check) as a loop candidate would be. */
async function judgeAll(img: string, script: ComicScript, pr: Pr) {
  const h = fileSha(img);
  const [observation, phone] = await Promise.all([
    cached(['observe', h], () => observe(img)),
    cached(['phone', h], () => phoneRead(img)),
  ]);
  const c = await cached(['check', h, sha(JSON.stringify(observation)), scriptKey(script), sha(pr.body)], () =>
    check(img, observation, pr, script),
  );
  return { observation, phone, check: c };
}

/** The repair-only loop from a starting image and script. */
async function loopArm(c: Case, dir: string, start: { image: string; script: ComicScript }) {
  const s: LoopState = newLoop();
  const scripts: Record<string, ComicScript> = {};
  const add = (img: string, script: ComicScript, kind: Candidate['kind'], target?: any) => {
    const id = `c${s.candidates.length + 1}`;
    const cdir = join(dir, id);
    mkdirSync(cdir, { recursive: true });
    if (resolve(img) !== resolve(join(cdir, 'comic.png'))) copyFileSync(img, join(cdir, 'comic.png'));
    scripts[id] = script;
    const parent = s.incumbent ?? s.candidates.at(-1)?.id ?? null;
    s.candidates.push({
      id,
      parent,
      kind,
      ...(target ? { target } : {}),
      imageSha256: fileSha(join(cdir, 'comic.png')),
      required: pageText(script),
      contractOk: !checkScript(script).some((p) => p.severity !== 'warning'),
      ...(kind === 'concrete' && parent
        ? { frozen: frozenProblems(scripts[parent]!, script, target) }
        : {}),
      reflow: phoneLayout(script)?.composition?.family ?? null,
    });
    return id;
  };
  add(start.image, start.script, 'initial');
  s.used.renders = 1;
  const img = (id: string) => join(dir, id, 'comic.png');
  const page = (id: string) =>
    ['png', 'jpeg', 'webp'].map((e) => join(dir, id, `page.${e}`)).find(existsSync) ?? img(id);
  for (let guard = 0; guard < 40; guard++) {
    const n = nextStep(s);
    if (n.action === 'stop') return { ...n, image: img(n.selected ?? 'c1'), state: s, scripts };
    if (n.action === 'observe' || n.action === 'phone' || n.action === 'check') {
      s.used.judgeCalls++;
      const cand = s.candidates.find((x) => x.id === n.candidate)!;
      const h = cand.imageSha256;
      if (n.action === 'observe') cand.observation = await cached(['observe', h], () => observe(img(cand.id)));
      else if (n.action === 'phone') cand.phone = await cached(['phone', h], () => phoneRead(img(cand.id)));
      else
        cand.check = await cached(
          ['check', h, sha(JSON.stringify(cand.observation)), scriptKey(scripts[cand.id]!), sha(c.pr.body)],
          () => check(img(cand.id), cand.observation!, c.pr, scripts[cand.id]),
        );
    } else if (n.action === 'compare') {
      s.used.judgeCalls++;
      const cmp = s.comparisons.find((x) => x.a === n.a && x.b === n.b)!;
      if (n.order === 1) cmp.first = await pairOnce(img(n.a), img(n.b));
      else cmp.second = await pairOnce(img(n.b), img(n.a));
    } else if (n.action === 'revise') {
      const base = s.incumbent ?? [...s.log].reverse().find((l) => l.decision === 'baseline')?.candidate ?? s.candidates.at(-1)!.id;
      const next = `c${s.candidates.length + 1}`;
      s.used.renders++;
      try {
        const reflowed = n.target === 'composition' ? phoneLayout(scripts[base]!) : undefined;
        if (reflowed) {
          // Geometry only: the same script in a layout that fits, drawn fresh.
          await render(reflowed, join(dir, next));
          add(join(dir, next, 'comic.png'), reflowed, 'concrete', n.target);
        } else {
          await render(scripts[base]!, join(dir, next), { ref: page(base), instruction: n.instruction });
          add(join(dir, next, 'comic.png'), scripts[base]!, 'concrete', n.target);
        }
      } catch (e) {
        s.log.push({ candidate: next, decision: 'failed', reason: String(e).slice(0, 200) });
        s.rejectedInARow++;
      }
      console.error(`${c.id}: revise ${n.target} -> ${s.candidates.at(-1)!.id}`);
    }
  }
  throw new Error('loop did not stop');
}

async function versus(x: string, y: string) {
  if (fileSha(x) === fileSha(y)) return { outcome: 'identical' as const, winner: null };
  const [first, second] = await Promise.all([pairOnce(x, y), pairOnce(y, x)]);
  const r = canonicalPair('x', 'y', first, second);
  return { outcome: r.outcome, winner: r.winner, raw: [first.preference, second.preference] };
}

const summaryOf = (j: Awaited<ReturnType<typeof judgeAll>>, script: ComicScript) => {
  const phone = phoneGate(j.phone, pageText(script));
  return {
    amusement: j.observation.scores.amusement.score,
    phone: phone.state,
    phoneMissing: phone.missing,
    gatesFailed: Object.entries(j.check.gates)
      .filter(([, g]) => g.state !== 'pass')
      .map(([k]) => k),
    eligible:
      phone.state === 'pass' &&
      Object.values(j.check.gates).every((g) => g.state === 'pass'),
    creativeGoalMet: creativeGoalMet(j.observation),
  };
};

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
  const [mode, name, casesFile, ...rest] = process.argv.slice(2);
  const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  if (!['targeted', 'full'].includes(mode ?? '') || !name || !casesFile) {
    console.error('Use: comic-loop-eval.ts targeted|full <name> <cases.json> [--only ids] [--parallel 3]');
    process.exit(2);
  }
  const base = resolve(casesFile, '..');
  const only = opt('--only')?.split(',');
  const cases: Case[] = (JSON.parse(readFileSync(casesFile, 'utf8')) as Case[])
    .filter((c) => c.arm === (opt('--arm') ?? 'round2') && (!only || only.includes(c.id)))
    .map((c) => ({ ...c, image: resolve(base, c.image), script: resolve(base, c.script) }));
  const root = evalDir('loop', name);
  setCallLog(join(root, 'calls.jsonl'));
  const started = Date.now();
  const results = await pool(cases, Number(opt('--parallel') ?? 3), async (c) => {
    const t0 = Date.now();
    const oldScript: ComicScript = JSON.parse(readFileSync(c.script, 'utf8'));
    try {
      let start = { image: c.image, script: oldScript };
      let firstRenderReflowed = false;
      if (mode === 'full') {
        const planned = phoneLayout(oldScript) ?? oldScript;
        firstRenderReflowed = planned !== oldScript;
        start = { image: await render(planned, join(root, c.id, 'first')), script: planned };
      }
      const loop = await loopArm(c, join(root, c.id, 'loop'), start);
      writeFileSync(join(root, c.id, 'loop.json'), JSON.stringify(loop.state, null, 2) + '\n');
      const first = loop.state.candidates[0]!;
      const finalId = loop.selected;
      const old = summaryOf(await judgeAll(c.image, oldScript, c.pr), oldScript);
      const vsOld = finalId ? await versus(c.image, loop.image) : { outcome: 'no-eligible-final', winner: null };
      const r = {
        id: c.id,
        oldImage: old,
        firstRender: {
          reflowedByPlan: firstRenderReflowed,
          eligible: usable(first),
          phone: phoneGate(first.phone, first.required).state,
          amusement: first.observation?.scores.amusement.score ?? null,
        },
        final: finalId
          ? (() => {
              const f = loop.state.candidates.find((x) => x.id === finalId)!;
              return {
                id: finalId,
                eligible: usable(f),
                phone: phoneGate(f.phone, f.required).state,
                amusement: f.observation?.scores.amusement.score ?? null,
                humorRegressed: loop.humorRegressed,
                unresolved: loop.unresolved,
              };
            })()
          : null,
        stop: loop.reason,
        frozenViolations: loop.state.candidates.filter((x) => x.frozen?.length).map((x) => ({ id: x.id, frozen: x.frozen })),
        renders: loop.state.used.renders + (mode === 'full' ? 0 : 0),
        loopJudgeCalls: loop.state.used.judgeCalls,
        log: loop.state.log,
        finalVsOld: { ...vsOld, finalIs: vsOld.winner === 'y' ? 'funnier' : vsOld.winner === 'x' ? 'less funny' : vsOld.outcome },
        minutes: Number(((Date.now() - t0) / 60000).toFixed(1)),
      };
      writeFileSync(join(root, c.id, 'result.json'), JSON.stringify(r, null, 2) + '\n');
      console.error(`${c.id}: first ${r.firstRender.eligible ? 'pass' : 'fail'}, final ${r.final?.eligible ? 'pass' : 'fail'}, vs old ${r.finalVsOld.finalIs}; stop: ${r.stop}`);
      return r;
    } catch (e) {
      console.error(`${c.id}: error ${String(e).slice(0, 300)}`);
      return { id: c.id, error: String(e).slice(0, 500) };
    }
  });
  const ok = results.filter((r): r is Exclude<typeof r, { error: string }> => !('error' in r));
  const count = (f: (r: (typeof ok)[number]) => boolean) => ok.filter(f).length;
  const humor = ok.reduce<Record<string, number>>(
    (m, r) => ((m[r.finalVsOld.finalIs] = (m[r.finalVsOld.finalIs] ?? 0) + 1), m),
    {},
  );
  const summary = {
    mode,
    label: 'AI-assessed with a frozen judge (single model, self-consistency only); not measured reader laughter',
    protocol: { rubricVersion: RUBRIC.rubricVersion, model: JUDGE_MODEL, creative: false },
    cases: cases.length,
    errors: results.length - ok.length,
    oldImagesPass: count((r) => r.oldImage.eligible),
    firstRenderPass: count((r) => r.firstRender.eligible),
    finalPass: count((r) => !!r.final?.eligible),
    phoneFirst: count((r) => r.firstRender.phone === 'pass'),
    phoneFinal: count((r) => r.final?.phone === 'pass'),
    humorVsOld: humor,
    humorRegressedFallbacks: count((r) => !!r.final?.humorRegressed),
    unmetCreativeGoal: count((r) => (r.final?.unresolved ?? []).some((u) => /flat/.test(u))),
    frozenViolations: ok.reduce((n, r) => n + r.frozenViolations.length, 0),
    renders: { firstRenders: mode === 'full' ? ok.length : 0, loop: ok.reduce((n, r) => n + r.renders - 1, 0), imageCalls: images },
    judge: { ...ledger, cost: Number(ledger.cost.toFixed(2)) },
    minutes: Number(((Date.now() - started) / 60000).toFixed(1)),
  };
  writeFileSync(join(root, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

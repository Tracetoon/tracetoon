/**
 * Dev-only humor experiment: different concepts vs repeated execution of one.
 *
 *   bun scripts/comic-concepts-eval.ts <name> <pr-numbers,comma> [--parallel 2]
 *
 * For each held-out merged PR, a headless drafter (the comic guide, the PR
 * description) writes three different concepts as complete comic.json files.
 * At an equal budget of 3 images per arm:
 *   (a) execution: concept 1 drawn 3 times, the blind winner kept;
 *   (b) concepts: concepts 1, 2 and 3 drawn once each, the blind winner kept;
 *   (c) current practice: concept 1 drawn once.
 * Concept 1's first drawing is shared by all three arms (5 images per story).
 * Every image is judged under the frozen v2.1 protocol (observe, phone, check);
 * only eligible images enter the tournaments (A/B and B/A, the incumbent kept
 * unless the challenger wins stably). Then (b) is compared with (a) and (c).
 * Predeclared rule: (b) is promoted only if it beats both (a) and (c) on
 * stable wins with no gate regressions. AI-assessed; not measured laughter.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { phoneLayout } from '../src/comic/composition.ts';
import {
  canonicalPair,
  creativeGoalMet,
  eligible,
  phoneGate,
  RUBRIC,
} from '../src/comic/judging.ts';
import { checkScript, pageText } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { git } from '../src/util/exec.ts';
import { draw } from './comic-draw.ts';
import {
  ask,
  check,
  JUDGE_MODEL,
  ledger,
  observe,
  pairOnce,
  phoneRead,
  setCallLog,
  type Pr,
} from './comic-judge.ts';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const images = { calls: 0, failed: 0 };
const drafter = { calls: 0, failed: 0 };
const GUIDE = ['comic-guide.md', 'comic-direction.md']
  .map((f) =>
    readFileSync(
      join(import.meta.dir, '..', 'plugin', 'skills', 'tracetoon', 'references', f),
      'utf8',
    ),
  )
  .join('\n\n');

function evalDir(...parts: string[]) {
  const r = git(process.cwd(), ['rev-parse', '--absolute-git-dir']);
  const dir = join(r.stdout.trim(), 'tracetoon', 'eval', ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function prOf(n: string): Pr {
  const raw = JSON.parse(
    execFileSync('gh', ['pr', 'view', n, '--json', 'title,body'], { encoding: 'utf8' }),
  );
  // The PR text only: drop the published comic, footers and markers.
  const body = String(raw.body)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/g, '')
    .replace(/<sub>[\s\S]*?<\/sub>/g, '')
    .trim();
  return { title: raw.title, body };
}

async function concepts(pr: Pr): Promise<ComicScript[]> {
  let problems = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    drafter.calls++;
    try {
      const out = await ask<{ concepts: { joke: string; comicJson: string }[] }>(
        `You draft comics for GitHub pull requests. Follow these guides:\n\n${GUIDE}\n\nPull request:\nTitle: ${pr.title}\n\n${pr.body.slice(0, 6000)}\n\nWrite THREE genuinely different concepts (different joke mechanisms and situations, not variations of one), each as a complete comic.json ("v": 2, with anchor, characters, style, format, composition, panels). Make each one as funny as you can. ${problems ? `Your last attempt failed the script check:\n${problems}\n` : ''}Return {concepts: [{joke, comicJson}]} with comicJson as a JSON string.`,
        [],
        {
          type: 'object',
          properties: {
            concepts: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                properties: { joke: { type: 'string' }, comicJson: { type: 'string' } },
                required: ['joke', 'comicJson'],
                additionalProperties: false,
              },
            },
          },
          required: ['concepts'],
          additionalProperties: false,
        },
        () => [],
        { stage: 'draft' },
      );
      const scripts = out.concepts.map((c) => JSON.parse(c.comicJson) as ComicScript);
      const errs = scripts.flatMap((s, i) =>
        checkScript(s)
          .filter((p) => p.severity !== 'warning')
          .map((p) => `concept ${i + 1} ${p.where}: ${p.problem}`),
      );
      if (!errs.length) return scripts.map((s) => phoneLayout(s) ?? s); // drafter follows the phone-fit warning
      problems = errs.join('\n');
    } catch (e) {
      drafter.failed++;
      problems = String(e).slice(0, 300);
    }
  }
  throw new Error(`drafting failed: ${problems}`);
}

async function render(script: ComicScript, dir: string) {
  images.calls++;
  try {
    return await draw(script, dir);
  } catch (e) {
    images.failed++;
    throw e;
  }
}

interface Judged {
  image: string;
  concept: number;
  draw: number;
  eligible: boolean;
  amusement: number | null;
  goal: boolean | null;
  phone: string;
  gatesFailed: string[];
}

async function judge(
  image: string,
  script: ComicScript,
  pr: Pr,
  concept: number,
  drawN: number,
): Promise<Judged> {
  const [o, phone] = await Promise.all([observe(image), phoneRead(image)]);
  const c = await check(image, o, pr, script);
  const pg = phoneGate(phone, pageText(script));
  return {
    image,
    concept,
    draw: drawN,
    eligible: eligible(c) && pg.state === 'pass',
    amusement: o.scores.amusement.score,
    goal: creativeGoalMet(o),
    phone: pg.state,
    gatesFailed: Object.entries(c.gates)
      .filter(([, g]) => g.state !== 'pass')
      .map(([k]) => k),
  };
}

async function versus(x: string, y: string) {
  if (sha(x) === sha(y))
    return { outcome: 'identical', winner: null as string | null, raw: [] as string[] };
  const [first, second] = await Promise.all([pairOnce(x, y), pairOnce(y, x)]);
  const r = canonicalPair(x, y, first, second);
  return {
    outcome: r.outcome,
    winner: r.winner,
    raw: [first.preference, second.preference],
  };
}

/** Keep the incumbent unless a challenger wins stably; only eligible images enter. */
async function tournament(entries: Judged[]) {
  const ok = entries.filter((e) => e.eligible);
  if (!ok.length) return { winner: null as Judged | null, matches: [] as unknown[] };
  let best = ok[0]!;
  const matches: unknown[] = [];
  for (const ch of ok.slice(1)) {
    const v = await versus(best.image, ch.image);
    matches.push({ a: best.image, b: ch.image, ...v });
    if (v.outcome === 'stable-win' && v.winner === ch.image) best = ch;
  }
  return { winner: best, matches };
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
  const [name, list, ...rest] = process.argv.slice(2);
  const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  if (!name || !list) {
    console.error('Use: comic-concepts-eval.ts <name> <pr-numbers,comma> [--parallel 2]');
    process.exit(2);
  }
  const root = evalDir('concepts', name);
  setCallLog(join(root, 'calls.jsonl'));
  const started = Date.now();
  const results = await pool(
    list.split(','),
    Number(opt('--parallel') ?? 2),
    async (n) => {
      const dir = join(root, `pr-${n}`);
      try {
        const pr = prOf(n);
        const scripts = await concepts(pr);
        scripts.forEach((s, i) =>
          writeFileSync(
            join(mkdirP(dir), `concept-${i + 1}.json`),
            JSON.stringify(s, null, 2) + '\n',
          ),
        );
        // Five drawings: concept 1 three times, concepts 2 and 3 once.
        const plan: [number, number][] = [
          [1, 1],
          [1, 2],
          [1, 3],
          [2, 1],
          [3, 1],
        ];
        const drawn = await Promise.all(
          plan.map(async ([c, d]) => {
            try {
              const img = await render(scripts[c - 1]!, join(dir, `c${c}-d${d}`));
              return await judge(img, scripts[c - 1]!, pr, c, d);
            } catch (e) {
              return {
                image: '',
                concept: c,
                draw: d,
                eligible: false,
                amusement: null,
                goal: null,
                phone: 'error',
                gatesFailed: [String(e).slice(0, 120)],
              } as Judged;
            }
          }),
        );
        const shared = drawn[0]!;
        const A = await tournament(drawn.filter((d) => d.concept === 1));
        const B = await tournament(drawn.filter((d) => d.draw === 1));
        const C = shared.eligible ? shared : null;
        const BvsA =
          B.winner && A.winner ? await versus(A.winner.image, B.winner.image) : null;
        const BvsC = B.winner && C ? await versus(C.image, B.winner.image) : null;
        const said = (v: typeof BvsA, arm: string) =>
          !v
            ? 'missing-eligible'
            : v.outcome === 'stable-win'
              ? v.winner === B.winner!.image
                ? 'concepts'
                : arm
              : v.outcome;
        const r = {
          pr: Number(n),
          title: pr.title,
          drawn,
          winners: { A: A.winner, B: B.winner, C },
          BvsA: { ...BvsA, result: said(BvsA, 'execution') },
          BvsC: { ...BvsC, result: said(BvsC, 'current') },
          bWinnerConcept: B.winner?.concept ?? null,
        };
        writeFileSync(
          join(dir, 'result.json'),
          JSON.stringify({ ...r, matches: { A: A.matches, B: B.matches } }, null, 2) +
            '\n',
        );
        console.error(
          `#${n}: B vs A ${r.BvsA.result}; B vs C ${r.BvsC.result}; B picked concept ${r.bWinnerConcept}`,
        );
        return r;
      } catch (e) {
        console.error(`#${n}: error ${String(e).slice(0, 300)}`);
        return { pr: Number(n), error: String(e).slice(0, 500) };
      }
    },
  );
  const ok = results.filter(
    (r): r is Exclude<typeof r, { error: string }> => !('error' in r),
  );
  const tally = (k: 'BvsA' | 'BvsC') =>
    ok.reduce<Record<string, number>>(
      (m, r) => ((m[r[k].result] = (m[r[k].result] ?? 0) + 1), m),
      {},
    );
  const all = ok.flatMap((r) => r.drawn);
  const summary = {
    label: 'AI-assessed with a frozen judge (single model); not measured reader laughter',
    protocol: { rubricVersion: RUBRIC.rubricVersion, model: JUDGE_MODEL },
    stories: results.length,
    errors: results.length - ok.length,
    conceptsVsExecution: tally('BvsA'),
    conceptsVsCurrent: tally('BvsC'),
    winnerConcept: ok.reduce<Record<string, number>>(
      (m, r) => (
        (m[String(r.bWinnerConcept)] = (m[String(r.bWinnerConcept)] ?? 0) + 1),
        m
      ),
      {},
    ),
    eligibleImages: `${all.filter((d) => d.eligible).length}/${all.length}`,
    meanAmusement: Object.fromEntries(
      [1, 2, 3].map((c) => {
        const xs = all
          .filter((d) => d.concept === c && d.amusement !== null)
          .map((d) => d.amusement!);
        return [
          `concept${c}`,
          Number((xs.reduce((a, b) => a + b, 0) / (xs.length || 1)).toFixed(2)),
        ];
      }),
    ),
    rule: 'promote concepts only if they beat both execution and current practice on stable wins with no gate regressions',
    calls: {
      judge: { ...ledger, cost: Number(ledger.cost.toFixed(2)) },
      images,
      drafter,
    },
    minutes: Number(((Date.now() - started) / 60000).toFixed(1)),
  };
  writeFileSync(
    join(root, 'results.json'),
    JSON.stringify({ summary, results }, null, 2) + '\n',
  );
  console.log(JSON.stringify(summary, null, 2));
}

function mkdirP(d: string) {
  mkdirSync(d, { recursive: true });
  return d;
}

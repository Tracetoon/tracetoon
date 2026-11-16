/**
 * Dev-only comic judge. Never shipped in the plugin.
 *
 * Runs Claude (headless Claude Code, `claude -p`, so the developer's own
 * subscription; no API key) on comic images:
 *  - a cold read: the image alone, before any PR context;
 *  - a scored read: the PR title and description, then scores and hard-fail flags;
 *  - pairwise: two comics for the same PR, asked twice with the order swapped.
 *
 *   bun scripts/comic-judge.ts score <image> [--pr pr.json]
 *   bun scripts/comic-judge.ts pair <imageA> <imageB> [--pr pr.json]
 *   bun scripts/comic-judge.ts sanity [--repeat 2]
 *   bun scripts/comic-judge.ts round <name> <cases.json>
 *
 * pr.json is { "title": "...", "body": "..." }. cases.json is a list of
 * { "id", "arm", "image", "script"?: path to comic.json, "pr"?: {title, body} }.
 * Results go to .git/tracetoon/eval/judge/<round>/ (scores.json, index.html).
 * Every call spends model tokens (roughly $0.25 each with Claude Opus 5.5).
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { esc } from '../src/comic/compose.ts';
import { comicSummary } from '../src/comic/composition.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { git } from '../src/util/exec.ts';

export const JUDGE_MODEL = process.env.TRACETOON_JUDGE_MODEL || 'claude-opus-5-5';
const CLAUDE = process.env.TRACETOON_JUDGE_BIN || 'claude';

export const CRITERIA = [
  'makesSense',
  'funny',
  'thisPr',
  'comicFeel',
  'textInScene',
  'layoutFits',
  'phoneReadable',
] as const;
export type Criterion = (typeof CRITERIA)[number];

const CRITERION_TEXT: Record<Criterion, string> = {
  makesSense:
    'Makes sense on a cold read: each panel follows from the last, props and characters stay consistent, the reader can say what happened.',
  funny:
    'Genuinely funny to a developer: a real punchline or comic turn, not just an illustrated explanation.',
  thisPr: 'Recognizably about this PR: a developer could name the change from the comic.',
  comicFeel:
    'Looks and reads like a drawn comic (inked line art, comic coloring, panels, balloons), not a 3D render, clay or toy diorama, stock illustration or picture-book painting.',
  textInScene:
    'Words belong to the scene (speech balloons, captions, screens, signs, objects) rather than pointer tags, arrows or callout labels annotating the drawing; lettering is clean.',
  layoutFits:
    'Panel count and layout fit the beats of the joke; the payoff gets the space it needs; not padded or cramped.',
  phoneReadable:
    'Readable at a 360px phone width: text large enough, key clue visible, clear reading order.',
};

export const FLAGS = [
  'pointer-tags',
  'code-speak',
  'inconsistent-props',
  'invisible-clue',
  'contradictory-reaction',
  'garbled-lettering',
  'not-a-comic',
  'no-punchline',
] as const;
const FLAG_TEXT: Record<(typeof FLAGS)[number], string> = {
  'pointer-tags':
    'pointer tags, arrows or callout labels annotate the drawing from outside',
  'code-speak': 'characters speak in code, flags or log lines instead of like people',
  'inconsistent-props': 'props or characters change between panels without reason',
  'invisible-clue': 'the clue the joke depends on is too small or unclear to see',
  'contradictory-reaction': "a character's reaction contradicts what happens",
  'garbled-lettering': 'misspelled, garbled or unreadable lettering',
  'not-a-comic':
    'looks like a 3D render, diorama, stock illustration or painting, not a comic',
  'no-punchline': 'there is no identifiable joke or payoff',
};

export interface ColdRead {
  panels: string[];
  story: string;
  joke: string;
  change: string;
}
export interface Scored {
  scores: Record<Criterion, { score: number; reason: string }>;
  flags: string[];
  summary: string;
}
export interface PairVerdict {
  winner: 'A' | 'B' | 'tie';
  byCriterion: Record<Criterion, 'A' | 'B' | 'tie'>;
  reason: string;
}
export interface Pr {
  title: string;
  body: string;
}

// ------------------------------------------------------------ the model call

async function ask<T>(
  prompt: string,
  images: string[],
  schema: object,
): Promise<{ value: T; cost: number }> {
  // Neutral file names in an empty folder, so names and repo context can't bias the judge.
  const dir = mkdtempSync(join(tmpdir(), 'comic-judge-'));
  try {
    const names = images.map((img, i) => {
      const name = `${String.fromCharCode(65 + i)}${extname(img).toLowerCase() || '.png'}`;
      copyFileSync(img, join(dir, name));
      return name;
    });
    const full =
      `${prompt}\n\nImages: ${names.map((n, i) => `image ${String.fromCharCode(65 + i)} is ./${n}`).join('; ')}. ` +
      'Read each image file with the Read tool before answering. Answer only with the structured result.';
    const out = await run(
      CLAUDE,
      [
        '-p',
        full,
        '--model',
        JUDGE_MODEL,
        '--effort',
        'high',
        '--output-format',
        'json',
        '--allowedTools',
        'Read',
        '--json-schema',
        JSON.stringify(schema),
      ],
      dir,
    );
    const json = JSON.parse(out);
    if (json.is_error || !json.structured_output)
      throw new Error(`judge failed: ${json.subtype ?? ''} ${json.result ?? ''}`.trim());
    return { value: json.structured_output as T, cost: Number(json.total_cost_usd ?? 0) };
  } finally {
    // Windows can hold the folder briefly after the CLI exits; a leftover temp folder is harmless.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {}
  }
}

function run(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0
        ? ok(out)
        : fail(new Error(`${bin} exited ${code}: ${err || out}`.slice(0, 2000))),
    );
  });
}

const str = { type: 'string' };
const scoreItem = {
  type: 'object',
  properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, reason: str },
  required: ['score', 'reason'],
  additionalProperties: false,
};
const side = { type: 'string', enum: ['A', 'B', 'tie'] };

// --------------------------------------------------------------- the judge

const ROLE =
  'You are a demanding comics editor who also writes software. You judge comics that appear at the top of GitHub pull requests. Be honest and specific; most comics are mediocre, and a 5 is rare.';

export async function coldRead(image: string) {
  return ask<ColdRead>(
    `${ROLE}\n\nYou see only the comic, with no other context. Report:\n- panels: what is literally visible in each panel, in reading order (one entry per panel);\n- story: what you infer happens, kept separate from observation;\n- joke: the comic turn, or "none" if you cannot find one;\n- change: which software change you think this comic is about, or "unclear".`,
    [image],
    {
      type: 'object',
      properties: {
        panels: { type: 'array', items: str, minItems: 1 },
        story: str,
        joke: str,
        change: str,
      },
      required: ['panels', 'story', 'joke', 'change'],
      additionalProperties: false,
    },
  );
}

export async function scoredRead(image: string, pr: Pr | undefined, cold: ColdRead) {
  const context = pr
    ? `The pull request it accompanies:\nTitle: ${pr.title}\n\n${pr.body.slice(0, 6000)}`
    : 'No pull request text is available; judge "thisPr" by whether a developer could tell what changed.';
  return ask<Scored>(
    `${ROLE}\n\nEarlier, reading the image cold, you wrote:\n${JSON.stringify(cold, null, 1)}\n\n${context}\n\nScore the comic 1–5 on each criterion (1 = fails, 3 = acceptable, 5 = excellent):\n${CRITERIA.map((c) => `- ${c}: ${CRITERION_TEXT[c]}`).join('\n')}\n\nThen list every hard-fail flag that applies (empty if none):\n${FLAGS.map((f) => `- ${f}: ${FLAG_TEXT[f]}`).join('\n')}\n\nsummary: one sentence a comics editor would say about it.`,
    [image],
    {
      type: 'object',
      properties: {
        scores: {
          type: 'object',
          properties: Object.fromEntries(CRITERIA.map((c) => [c, scoreItem])),
          required: [...CRITERIA],
          additionalProperties: false,
        },
        flags: { type: 'array', items: { type: 'string', enum: [...FLAGS] } },
        summary: str,
      },
      required: ['scores', 'flags', 'summary'],
      additionalProperties: false,
    },
  );
}

async function pairOnce(a: string, b: string, pr: Pr | undefined) {
  const context = pr
    ? `Both comics accompany this pull request:
Title: ${pr.title}

${pr.body.slice(0, 6000)}`
    : 'The two comics are about different subjects, so do not compare relevance: mark thisPr as tie, and judge the overall winner only on the other criteria (does it make sense, is it funny, does it look and read like a good comic).';
  return ask<PairVerdict>(
    `${ROLE}\n\nCompare comic A and comic B. ${context}\n\nFor each criterion say which is better (A, B or tie):\n${CRITERIA.map((c) => `- ${c}: ${CRITERION_TEXT[c]}`).join('\n')}\n\nThen the overall winner: which one would you rather see at the top of the PR? reason: one or two sentences.`,
    [a, b],
    {
      type: 'object',
      properties: {
        winner: side,
        byCriterion: {
          type: 'object',
          properties: Object.fromEntries(CRITERIA.map((c) => [c, side])),
          required: [...CRITERIA],
          additionalProperties: false,
        },
        reason: str,
      },
      required: ['winner', 'byCriterion', 'reason'],
      additionalProperties: false,
    },
  );
}

const flip = (s: 'A' | 'B' | 'tie') => (s === 'A' ? 'B' : s === 'B' ? 'A' : 'tie');

/** A verdict counts only when it survives swapping the order; otherwise it's a tie. */
export async function pair(a: string, b: string, pr?: Pr) {
  const [first, second] = await Promise.all([pairOnce(a, b, pr), pairOnce(b, a, pr)]);
  const swapped = flip(second.value.winner);
  const winner = first.value.winner === swapped ? first.value.winner : 'tie';
  return {
    winner,
    stable: first.value.winner === swapped,
    first: first.value,
    second: { ...second.value, winner: swapped },
    cost: first.cost + second.cost,
  };
}

export async function score(image: string, pr?: Pr) {
  const cold = await coldRead(image);
  const scored = await scoredRead(image, pr, cold.value);
  const values = CRITERIA.map((c) => scored.value.scores[c].score);
  return {
    cold: cold.value,
    ...scored.value,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    cost: cold.cost + scored.cost,
  };
}

// ----------------------------------------------------------------- helpers

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
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

function evalDir(...parts: string[]): string {
  const r = git(process.cwd(), ['rev-parse', '--absolute-git-dir']);
  if (!r.ok) throw new Error('Run inside the tracetoon git repository.');
  const dir = join(r.stdout.trim(), 'tracetoon', 'eval', ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Case {
  id: string;
  arm: string;
  image: string;
  script?: string;
  pr?: Pr;
}

/** Set-level variety from the scripts: what the comics are made of, not how good they are. */
export function variety(scripts: ComicScript[]) {
  const count = <K extends string | number>(xs: K[]) =>
    xs.reduce<Record<string, number>>(
      (m, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m),
      {},
    );
  const dialogue = (s: ComicScript) =>
    s.panels
      .flatMap((p) => p.dialogue ?? [])
      .filter((d) => !d.kind || d.kind === 'speech' || d.kind === 'thought');
  const n = scripts.length || 1;
  return {
    comics: scripts.length,
    panelCounts: count(scripts.map((s) => s.panels.length)),
    layoutFamilies: count(scripts.map((s) => s.composition?.family ?? 'legacy')),
    styleFamilies: count(scripts.map((s) => comicSummary(s).styleFamily ?? 'unknown')),
    styles: count(scripts.map((s) => s.style)),
    twoPanelShare: scripts.filter((s) => s.panels.length === 2).length / n,
    labelShare:
      scripts.filter((s) =>
        s.panels.some((p) => p.dialogue?.some((d) => d.kind === 'label')),
      ).length / n,
    dialogueShare: scripts.filter((s) => dialogue(s).length > 0).length / n,
  };
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

// ---------------------------------------------------------------- commands

async function round(name: string, casesFile: string) {
  const cases: Case[] = JSON.parse(readFileSync(casesFile, 'utf8'));
  const base = resolve(casesFile, '..');
  for (const c of cases) {
    c.image = resolve(base, c.image);
    if (c.script) c.script = resolve(base, c.script);
    if (!existsSync(c.image)) throw new Error(`${c.id}/${c.arm}: no image at ${c.image}`);
  }
  const dir = evalDir('judge', name);
  const scored = await pool(cases, 4, async (c) => {
    const s = await score(c.image, c.pr);
    console.error(
      `${c.id} ${c.arm}: mean ${s.mean.toFixed(2)} flags [${s.flags.join(', ')}]`,
    );
    return { ...c, ...s };
  });
  // Pairwise between arms on the same case.
  const arms = [...new Set(cases.map((c) => c.arm))];
  const pairs: {
    id: string;
    a: string;
    b: string;
    winner: string;
    stable: boolean;
    reason: string;
  }[] = [];
  if (arms.length >= 2) {
    const jobs = [...new Set(cases.map((c) => c.id))].flatMap((id) => {
      const mine = cases.filter((c) => c.id === id);
      return mine.flatMap((x, i) => mine.slice(i + 1).map((y) => [x, y] as const));
    });
    pairs.push(
      ...(await pool(jobs, 2, async ([x, y]) => {
        const p = await pair(x.image, y.image, x.pr);
        console.error(
          `${x.id}: ${x.arm} vs ${y.arm} -> ${p.winner === 'A' ? x.arm : p.winner === 'B' ? y.arm : 'tie'}`,
        );
        return {
          id: x.id,
          a: x.arm,
          b: y.arm,
          winner: p.winner === 'A' ? x.arm : p.winner === 'B' ? y.arm : 'tie',
          stable: p.stable,
          reason: p.first.reason,
        };
      })),
    );
  }
  const byArm = Object.fromEntries(
    arms.map((arm) => {
      const mine = scored.filter((s) => s.arm === arm);
      const scripts = mine.flatMap((s) =>
        s.script && existsSync(s.script)
          ? [JSON.parse(readFileSync(s.script, 'utf8')) as ComicScript]
          : [],
      );
      return [
        arm,
        {
          comics: mine.length,
          mean: mean(mine.map((s) => s.mean)),
          criteria: Object.fromEntries(
            CRITERIA.map((c) => [c, mean(mine.map((s) => s.scores[c].score))]),
          ),
          flagged: Object.fromEntries(
            FLAGS.map((f) => [f, mine.filter((s) => s.flags.includes(f)).length]),
          ),
          pairwiseWins: pairs.filter((p) => p.winner === arm).length,
          variety: variety(scripts),
        },
      ];
    }),
  );
  const cost = scored.reduce((n, s) => n + s.cost, 0);
  const result = {
    v: 1,
    model: JUDGE_MODEL,
    at: new Date().toISOString(),
    byArm,
    pairs,
    comics: scored,
    cost,
  };
  writeFileSync(join(dir, 'scores.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(dir, 'index.html'), gallery(name, result));
  console.log(
    JSON.stringify(
      { byArm, pairs: pairs.length, cost: Number(cost.toFixed(2)) },
      null,
      2,
    ),
  );
  console.log(pathToFileURL(join(dir, 'index.html')).href);
}

function gallery(
  name: string,
  r: { byArm: Record<string, any>; comics: any[]; pairs: any[] },
) {
  const armRows = Object.entries(r.byArm)
    .map(
      ([arm, a]) =>
        `<tr><th>${esc(arm)}</th><td>${a.mean.toFixed(2)}</td>${CRITERIA.map((c) => `<td>${a.criteria[c].toFixed(2)}</td>`).join('')}<td>${a.pairwiseWins}</td><td>${(a.variety.twoPanelShare * 100).toFixed(0)}%</td><td>${(a.variety.dialogueShare * 100).toFixed(0)}%</td><td>${(a.variety.labelShare * 100).toFixed(0)}%</td></tr>`,
    )
    .join('');
  const cards = r.comics
    .map(
      (
        c,
      ) => `<article><h2>${esc(c.id)} · ${esc(c.arm)} · ${c.mean.toFixed(2)}</h2><img src="${pathToFileURL(c.image).href}" alt="comic">
<p><b>Editor:</b> ${esc(c.summary)}</p>
${c.flags.length ? `<p class="flags">${c.flags.map(esc).join(' · ')}</p>` : ''}
<details><summary>Cold read</summary><ol>${c.cold.panels.map((p: string) => `<li>${esc(p)}</li>`).join('')}</ol><p><b>Joke:</b> ${esc(c.cold.joke)}</p><p><b>Change:</b> ${esc(c.cold.change)}</p></details>
<details><summary>Scores</summary><ul>${CRITERIA.map((k) => `<li><b>${k} ${c.scores[k].score}</b>: ${esc(c.scores[k].reason)}</li>`).join('')}</ul></details></article>`,
    )
    .join('\n');
  const pairRows = r.pairs
    .map(
      (p) =>
        `<li>${esc(p.id)}: ${esc(p.a)} vs ${esc(p.b)} → <b>${esc(p.winner)}</b>${p.stable ? '' : ' (unstable)'}: ${esc(p.reason)}</li>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comic judge: ${esc(name)}</title><style>body{background:#eef0f3;color:#161c24;font:15px/1.5 system-ui;margin:16px}table{border-collapse:collapse;background:#fff;margin:12px 0;overflow-x:auto;display:block}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:right}.grid{display:flex;flex-wrap:wrap;gap:20px}article{background:#fff;border-radius:12px;padding:16px;width:min(720px,100%)}img{width:100%;height:auto}.flags{color:#b42318;font-weight:600}</style></head><body><h1>Comic judge: ${esc(name)}</h1>
<table><tr><th>arm</th><th>mean</th>${CRITERIA.map((c) => `<th>${c}</th>`).join('')}<th>pair wins</th><th>2-panel</th><th>dialogue</th><th>labels</th></tr>${armRows}</table>
${pairRows ? `<h2>Pairwise</h2><ul>${pairRows}</ul>` : ''}<div class="grid">${cards}</div></body></html>`;
}

/**
 * Before trusting the judge: it must prefer the hand-made site comics over
 * current pipeline output, and give stable scores for the same image.
 */
async function sanity(repeat: number) {
  const root = process.cwd();
  const good = readdirSync(join(root, 'docs', 'img'))
    .filter((f) => /^comic-.*\.webp$/.test(f))
    .map((f) => join(root, 'docs', 'img', f));
  const runs = evalDir('..', 'runs');
  const bad = readdirSync(runs)
    .filter((d) => /^\d{8}-\d{6}/.test(d))
    .map((d) => join(runs, d, 'out', 'comic.png'))
    .filter(existsSync)
    .slice(-good.length);
  const n = Math.min(good.length, bad.length);
  if (!n)
    throw new Error(
      'Need site comics in docs/img and generated comics in .git/tracetoon/runs.',
    );
  const pairs = await pool(
    Array.from({ length: n }, (_, i) => [good[i]!, bad[i]!] as const),
    2,
    async ([g, b]) => {
      const p = await pair(g, b);
      console.error(
        `${basename(g)} vs ${basename(resolve(b, '../..'))}: ${p.winner}${p.stable ? '' : ' (unstable)'}`,
      );
      return p;
    },
  );
  const preferGood = pairs.filter((p) => p.winner === 'A').length / n;
  const stableShare = pairs.filter((p) => p.stable).length / n;
  const probe = [good[0]!, bad[0]!];
  const repeats = await pool(
    probe.flatMap((img) => Array.from({ length: repeat }, () => img)),
    3,
    (img) => score(img),
  );
  const spread = probe.map((img, i) => {
    const mine = repeats.slice(i * repeat, (i + 1) * repeat);
    return Math.max(
      ...CRITERIA.map(
        (c) =>
          Math.max(...mine.map((m) => m.scores[c].score)) -
          Math.min(...mine.map((m) => m.scores[c].score)),
      ),
    );
  });
  // Per criterion, counted only where both orders agree.
  const criterionPreference = Object.fromEntries(
    CRITERIA.filter((c) => c !== 'thisPr').map((c) => [
      c,
      pairs.filter(
        // The second run saw the site comic as B.
        (p) => p.first.byCriterion[c] === 'A' && p.second.byCriterion[c] === 'B',
      ).length / n,
    ]),
  );
  const result = {
    criterionPreference,
    details: pairs.map((p, i) => ({
      site: basename(good[i]!),
      run: basename(resolve(bad[i]!, '../..')),
      winner: p.winner,
      reason: p.first.reason,
    })),
    // The site comics are hand-made for their look, not their jokes or a PR,
    // so the check is that the judge sees their comic feel as better.
    knownContrast: {
      pairs: n,
      preferSiteOverall: preferGood,
      preferSiteComicFeel: criterionPreference.comicFeel,
      stableUnderSwap: stableShare,
      pass: (criterionPreference.comicFeel ?? 0) >= 0.8,
    },
    stability: { repeat, maxCriterionSpread: spread, pass: spread.every((s) => s <= 1) },
    cost: [...pairs, ...repeats].reduce((s, p) => s + p.cost, 0),
  };
  writeFileSync(
    join(evalDir('judge'), 'sanity.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const prFile = flag(args, '--pr');
  const pr: Pr | undefined = prFile
    ? JSON.parse(readFileSync(prFile, 'utf8'))
    : undefined;
  const positional = args.filter(
    (a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'),
  );
  if (cmd === 'score')
    console.log(JSON.stringify(await score(positional[0]!, pr), null, 2));
  else if (cmd === 'pair')
    console.log(JSON.stringify(await pair(positional[0]!, positional[1]!, pr), null, 2));
  else if (cmd === 'sanity') await sanity(Number(flag(args, '--repeat') ?? 2));
  else if (cmd === 'round') await round(positional[0]!, positional[1]!);
  else {
    console.error(
      'Use: score <image> | pair <a> <b> | sanity | round <name> <cases.json>  [--pr pr.json]',
    );
    process.exit(2);
  }
}

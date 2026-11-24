/**
 * `tracetoon comic run`: the whole comic in one blocking command, with every
 * agent started by Tracetoon itself (see printAgent.ts), so an agent that
 * can't start subagents (a delegated drafter) gets the same comic as one that
 * can, and the comic can run at the same time as `tracetoon review run`.
 *
 *   packet → a fresh comic author (follows the draw-cartoon skill with the
 *   packet; replies with comic-design.json and comic.json, corrected in the
 *   same session until `comic check` passes) → `comic art` → `comic render`
 *   → the quality loop, each judge a fresh session that sees only its packet,
 *   imported with its real session id and verified model, and the loop's
 *   repairs → the selected image in out/comic.png, or `comic skip` with why.
 *
 * Steps that already exist as commands run as this same CLI (`--json`), so
 * their rules, exit codes and state stay the single source of truth.
 *
 * When the image route needs the user (no route yet, or consent), nothing is
 * asked: the skip is recorded and a `COMIC SETUP:` line says what the user
 * can do, for the agent to relay.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.ts';
import { COMIC_SETUP_LINE, type ComicExpectation } from '../comic/expectation.ts';
import { CONCRETE_TARGETS, type IssueTarget } from '../comic/judging.ts';
import { runCli } from '../comic/providers.ts';
import { nextStep as routeStep, routeStatuses } from '../comic/routes.ts';
import { clearComicStatus, readComicStatus, writeComicStatus } from '../comic/status.ts';
import { assertRunOwner, findRun, readJson, writeJson, type Run } from '../run.ts';
import { selfProgram } from '../util/userCommand.ts';
import { repository } from '../workflow/state.ts';
import { recordJudgeProvenance } from './comicLoop.ts';
import { emit, UserError, type OutOpts } from './output.ts';
import { printAgent, runPrint, type PrintAgent, type PrintReply } from './printAgent.ts';
import { extractJson } from './reviewRun.ts';

export const RESULT_FILE = 'comic-run.json';
const LOCK_FILE = 'comic-run.lock';
/** Correction rounds for the author until `comic check` passes. */
export const AUTHOR_ROUNDS = 3;
/** Loop steps before giving up (the loop's own budget stops it far sooner). */
const MAX_STEPS = 40;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/** Replaces the packet's "write the files and run the check" steps for the author. */
export const AUTHOR_OVERRIDE = [
  '## Override for this run',
  '',
  'You were started by `tracetoon comic run` as the comic author, in a fresh session.',
  'You can read files (the instruction files and the packet files above), but you',
  'cannot write files or run commands. Instead of writing the design file and',
  'comic.json and running the check, reply with ONLY one JSON object (no prose, no',
  'code fence): {"design": <the content of the design file>, "comic": <the content',
  'of comic.json>}. Tracetoon writes both files and runs the check; if it finds',
  'errors, it sends them to you in this same session to fix.',
].join('\n');

/** Replaces the judge packet's "write your answer to result.json" step. */
export const JUDGE_OVERRIDE = [
  '## Override for this run',
  '',
  'You were started by `tracetoon comic run` as a fresh judge. Look at the image',
  'files listed above (read them with your file-reading tool; on hosts that attach',
  'images they are attached too). Do not write the result file and run no',
  'commands: reply with ONLY the JSON answer (no prose, no code fence) in the',
  'schema above. Tracetoon writes it to the result file.',
].join('\n');

export interface ComicRunOpts extends OutOpts {
  run?: string;
  /** Pin the author's and judges' model; default: the host's own default model. */
  model?: string;
  /** Experimental, as `comic loop --creative`: also rewrite a flat joke or weak script. */
  creative?: boolean;
}

interface AgentRecord {
  role: 'author' | 'judge';
  task?: string;
  runner: PrintAgent['runner'];
  sessionId: string;
  verifiedModel: string | null;
}

export interface ComicRunResult {
  run: string;
  /** drawn: out/comic.png holds the selected image; skipped: recorded with a reason. */
  state: 'drawn' | 'skipped' | 'not-expected' | 'no-route';
  reason?: string;
  comic?: string;
  selected?: string | null;
  unresolved?: string[];
  /** The line for the agent's final reply when the image route needs the user. */
  comicSetup?: string;
  agents: AgentRecord[];
}

function timeoutMs(): number {
  const v = Number(process.env.TRACETOON_COMIC_RUN_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

/** This CLI, run as a child with --json: its exit code and its JSON output. */
async function tracetoon(
  cwd: string,
  args: string[],
): Promise<{ code: number | null; json: any }> {
  const [bin, ...pre] = selfProgram();
  const res = await runCli(bin!, [...pre, '--json', ...args], cwd, 30 * 60_000);
  let json: any;
  try {
    const out = res.stdout.trim();
    json = out ? JSON.parse(out.slice(out.indexOf('{'))) : undefined;
  } catch {
    json = undefined;
  }
  if (json === undefined && res.code !== 0)
    json = { error: res.stderr.trim().split('\n').pop() ?? `exited ${res.code}` };
  return { code: res.code, json: json ?? {} };
}

const firstLine = (s: unknown) =>
  String(s ?? '')
    .split('\n')[0]!
    .trim();

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function comicRunCmd(cwd: string, opts: ComicRunOpts): Promise<void> {
  const repo = repository(cwd);
  const run = findRun(repo.gitDir, opts.run);
  assertRunOwner(run, repo.root, repo.branch);
  const lock = join(run.dir, LOCK_FILE);
  let result: ComicRunResult | undefined;
  const held = readJson<{ pid?: number }>(run, LOCK_FILE);
  if (held?.pid && held.pid !== process.pid && alive(held.pid)) {
    // Another comic run for this run is live (a call moved to the background):
    // wait for it and report its result.
    while (existsSync(lock) && alive(held.pid)) await Bun.sleep(2000);
    result = readJson<ComicRunResult>(run, RESULT_FILE);
    if (!result) throw new UserError('The other tracetoon comic run ended without a result; run it again.');
  } else {
    writeJson(run, LOCK_FILE, { pid: process.pid, startedAt: new Date().toISOString() });
    try {
      result = await drive(repo.root, run, opts);
      writeJson(run, RESULT_FILE, result);
    } finally {
      rmSync(lock, { force: true });
    }
  }
  const r = result;
  emit(opts, r, () =>
    [
      r.state === 'drawn'
        ? `Comic drawn and judged: ${r.comic}${r.unresolved?.length ? ` (unresolved: ${r.unresolved.join('; ')})` : ''}. Render (tracetoon finish) includes it.`
        : r.state === 'skipped'
          ? `No comic on this PR, recorded: ${r.reason}.`
          : r.state === 'no-route'
            ? `No image route can draw the comic (${r.reason}); the PR goes out without one and says so.`
            : `No comic expected for this PR${r.reason ? ` (${r.reason})` : ''}.`,
      r.comicSetup ? `${COMIC_SETUP_LINE} ${r.comicSetup}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function drive(root: string, run: Run, opts: ComicRunOpts): Promise<ComicRunResult> {
  const agents: AgentRecord[] = [];
  const base = { run: run.id, agents };
  const skip = (reason: string, comicSetup?: string): ComicRunResult => {
    writeComicStatus(run, { state: 'skipped', by: 'agent', detail: reason });
    return { ...base, state: 'skipped', reason, ...(comicSetup ? { comicSetup } : {}) };
  };
  const ctx = readJson<{ comic?: { expectation?: ComicExpectation } }>(run, 'context.json');
  const e = ctx?.comic?.expectation;
  if (!e?.expected) return { ...base, state: 'not-expected', reason: e?.why || undefined };
  const recorded = readComicStatus(run);
  if (recorded?.state === 'skipped')
    return { ...base, state: 'skipped', reason: recorded.detail };
  // The route as it is now: the user may have approved one since prepare.
  const route = routeStep(routeStatuses(root, false), loadConfig(root).comic);
  if (route.kind !== 'ready')
    return e.askSetup
      ? skip("image setup awaits the user's answer", route.text)
      : { ...base, state: 'no-route', reason: route.text };

  const agent = printAgent('tracetoon comic run');
  const call = async (
    role: AgentRecord['role'],
    c: Parameters<typeof runPrint>[1],
    task?: string,
  ): Promise<PrintReply> => {
    const r = await runPrint(agent, { ...c, ...(opts.model ? { model: opts.model } : {}) });
    agents.push({
      role,
      ...(task ? { task } : {}),
      runner: agent.runner,
      sessionId: r.sessionId,
      verifiedModel: r.verifiedModel,
    });
    return r;
  };
  const tt = (args: string[]) => tracetoon(root, [...args, '--run', run.id]);
  const png = join(run.dir, 'out', 'comic.png');

  // ------------------------------------------------------------ author
  let author: { sessionId: string; readDirs: string[] } | undefined;
  /** Send the author a message (fresh with the packet, or a correction) until comic check passes. */
  const authorRounds = async (first: string, resume?: string): Promise<string | undefined> => {
    let prompt = first;
    let session = resume;
    for (let round = 1; round <= AUTHOR_ROUNDS; round++) {
      let r: PrintReply;
      try {
        r = await call('author', {
          prompt,
          cwd: run.dir,
          readDirs: author?.readDirs ?? [],
          timeoutMs: timeoutMs(),
          tag: 'author',
          ...(session ? { resume: session } : {}),
        });
      } catch (err) {
        return `the comic author could not run (${(err as Error).message})`;
      }
      session = r.sessionId;
      author = { sessionId: r.sessionId, readDirs: author?.readDirs ?? [] };
      let problems: string;
      try {
        const obj = extractJson(r.reply) as { design?: unknown; comic?: unknown };
        if (!obj || typeof obj !== 'object' || !obj.comic || typeof obj.comic !== 'object')
          throw new Error('the reply has no "comic" object');
        if (obj.design !== undefined)
          writeFileSync(
            join(run.dir, 'comic-design.json'),
            JSON.stringify(obj.design, null, 2) + '\n',
          );
        writeFileSync(join(run.dir, 'comic.json'), JSON.stringify(obj.comic, null, 2) + '\n');
        const check = await tt(['comic', 'check']);
        if (check.code === 0) return undefined;
        problems = (check.json.problems ?? [])
          .map(
            (p: { severity?: string; problem?: string; where?: string }) =>
              `- ${p.severity ?? 'error'}${p.where ? ` (${p.where})` : ''}: ${p.problem ?? JSON.stringify(p)}`,
          )
          .join('\n') || firstLine(check.json.error) || 'comic check failed';
      } catch (err) {
        problems = `- ${(err as Error).message}`;
      }
      prompt = `\`tracetoon comic check\` found these problems:\n${problems}\n\nFix every error and reply with the whole JSON object again ({"design": …, "comic": …}), nothing else.`;
    }
    return `the comic script did not pass comic check after ${AUTHOR_ROUNDS} rounds`;
  };

  const check = existsSync(join(run.dir, 'comic.json')) ? await tt(['comic', 'check']) : undefined;
  const resuming = check?.code === 0 && existsSync(png);
  if (!resuming) {
    const packet = await tt(['comic', 'packet']);
    if (packet.code !== 0) return skip(`the comic packet could not be written: ${firstLine(packet.json.error)}`);
    const packetPath = String(packet.json.packet);
    const skillFiles: string[] = packet.json.skillFiles ?? [];
    author = {
      sessionId: '',
      readDirs: [...new Set([dirname(packetPath), ...skillFiles.map((f) => dirname(f))])],
    };
    const failed = await authorRounds(
      [
        readFileSync(packetPath, 'utf8').trimEnd(),
        '',
        `(The packet files sit in ${dirname(packetPath)}.)`,
        '',
        AUTHOR_OVERRIDE,
        '',
      ].join('\n'),
    );
    if (failed) return skip(failed);

    // ------------------------------------------------------------ art
    const drawn = await draw([]);
    if (drawn) return drawn;
    const rendered = await tt(['comic', 'render']);
    if (rendered.code !== 0) return skip(`rendering failed: ${firstLine(rendered.json.error)}`);
  }

  /** `comic art` with these flags; a result when the comic ends here, else undefined. */
  async function draw(flags: string[]): Promise<ComicRunResult | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const art = await tt(['comic', 'art', ...flags, ...(attempt ? ['--force'] : [])]);
      if (art.code === 0) return undefined;
      if (art.code === 4 || art.code === 5)
        return skip(
          "the image route needs the user's approval",
          `${firstLine(art.json.error)}${art.json.fix ? ` ${art.json.fix}.` : ''}`,
        );
      if (attempt === 1) return skip(`drawing kept failing: ${firstLine(art.json.error)}`);
    }
    return undefined;
  }

  // ------------------------------------------------------------ quality loop
  let failures = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const l = await tt(['comic', 'loop', ...(opts.creative ? ['--creative'] : [])]);
    if (l.code !== 0) break;
    const n = l.json;
    if (n.action === 'stop') {
      if (!n.selected && !existsSync(png))
        return skip('no drawing of the comic passed the quality checks');
      if (!n.selected)
        return skip(`no drawing of the comic passed the quality checks (${firstLine(n.reason)})`);
      clearComicStatus(run);
      return {
        ...base,
        state: 'drawn',
        comic: png,
        selected: n.selected,
        unresolved: n.unresolved ?? [],
      };
    }
    if (n.action === 'revise') {
      const target = n.target as IssueTarget;
      let ok = true;
      if (CONCRETE_TARGETS.includes(target)) {
        const flags =
          target === 'composition' ? ['--reflow'] : ['--repair', String(n.instruction)];
        let art = await tt(['comic', 'art', ...flags]);
        if (art.code !== 0 && target === 'composition')
          art = await tt(['comic', 'art', '--repair', String(n.instruction)]);
        if (art.code === 4 || art.code === 5)
          return skip(
            "the image route needs the user's approval",
            `${firstLine(art.json.error)}${art.json.fix ? ` ${art.json.fix}.` : ''}`,
          );
        ok = art.code === 0;
      } else if (author?.sessionId) {
        // A creative rewrite (only with --creative): the same author session rewrites comic.json.
        const failed = await authorRounds(
          `The quality loop asks for this change to the comic: ${n.instruction}\nWhy: ${n.reason}${n.preserve?.length ? `\nKeep: ${n.preserve.join('; ')}` : ''}\nKeep the PR facts. Reply with the whole JSON object again ({"design": …, "comic": …}), nothing else.`,
          author.sessionId,
        );
        ok = !failed && (await tt(['comic', 'art', '--force'])).code === 0;
      } else ok = false;
      if (ok) ok = (await tt(['comic', 'render'])).code === 0;
      // A failed repair still spent its render budget; two in a row end the loop.
      if (!ok && ++failures >= 2) break;
      if (ok) failures = 0;
      continue;
    }
    // A judge: a fresh session that sees only its packet.
    const packet = String(n.packet);
    const dir = dirname(packet);
    const images = readdirSync(dir)
      .filter((f) => /\.png$/i.test(f))
      .map((f) => join(dir, f));
    let r: PrintReply;
    try {
      r = await call(
        'judge',
        {
          prompt: `${readFileSync(packet, 'utf8').trimEnd()}\n\n${JUDGE_OVERRIDE}\n`,
          cwd: dir,
          images,
          timeoutMs: timeoutMs(),
          tag: String(n.task).replace(/:/g, '-'),
        },
        String(n.task),
      );
    } catch {
      if (++failures >= 2) break;
      continue;
    }
    const task = String(n.task);
    const importAnswer = async (reply: string) => {
      let parsed = true;
      try {
        writeFileSync(String(n.result), JSON.stringify(extractJson(reply), null, 2) + '\n');
      } catch {
        writeFileSync(String(n.result), reply);
        parsed = false;
      }
      const imported = await tt(['comic', 'loop-import', '--task', task, '--agent-id', r.sessionId]);
      return { parsed, imported };
    };
    let { parsed, imported } = await importAnswer(r.reply);
    if (imported.code !== 0) {
      // One correction in the same judge session: a reply that wasn't the JSON
      // answer (the live run asked a checker six times), or one the loop rejected.
      try {
        r = await call(
          'judge',
          {
            prompt: parsed
              ? `Tracetoon could not use that answer:\n${firstLine(imported.json.error)}\n${String(imported.json.error ?? '').split('\n').slice(1).join('\n')}\nReply with ONLY the corrected JSON answer (no prose, no code fence, no files).`
              : 'Your reply was not the JSON answer. Reply with ONLY the JSON object in the schema the packet gives (no prose, no code fence, no files, no commands).',
            cwd: dir,
            timeoutMs: timeoutMs(),
            tag: task.replace(/:/g, '-'),
            resume: r.sessionId,
          },
          task,
        );
        ({ imported } = await importAnswer(r.reply));
      } catch {
        /* counted below */
      }
    }
    if (imported.code === 0) {
      recordJudgeProvenance(run, task, {
        source: 'tracetoon-run',
        runner: agent.runner,
        sessionId: r.sessionId,
        verifiedModel: r.verifiedModel,
      });
      failures = 0;
    } else if (++failures >= 2) break;
  }
  // The loop could not finish: keep the image already rendered, if any.
  if (existsSync(png)) {
    clearComicStatus(run);
    return {
      ...base,
      state: 'drawn',
      comic: png,
      unresolved: ['the quality loop could not finish; the last rendered image is kept'],
    };
  }
  return skip('the comic could not be drawn and judged');
}

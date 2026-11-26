/**
 * `tracetoon comic gags`: the select step of an isekai comic's brainstorm.
 * `--check` lints the author's comic-gags.json. Without it, the first run
 * writes a packet for one fresh judge (the PR and the gags only); the next
 * run, once the judge wrote its scores, picks the best gag and records it in
 * context.json, so `tracetoon comic packet` hands the author that gag to script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GenreOption } from '../comic/genres.ts';
import { gagJudgePrompt, gagProblems, pickGag, scoreProblems, type GagJudging, type GagsFile } from '../comic/isekai/pitches.ts';
import { assertRunOwner, findRun, readJson, readText, writeJson, type Run } from '../run.ts';
import { repository } from '../workflow/state.ts';
import { emit, UserError, type OutOpts } from './output.ts';

export interface GagsOpts extends OutOpts {
  run?: string;
  /** Only lint comic-gags.json. */
  check?: boolean;
  /** With --check: a gags file outside any run (a comic author's packet output, comicbench). */
  file?: string;
  /** With --file: the packet's context.json (its genreOptions). */
  context?: string;
  /** With --file: the PR's description, brief or diff, so the anchor's words are checked against the PR. */
  evidence?: string[];
}

export const GAG_FILES = { gags: 'comic-gags.json', scores: 'comic-gag-scores.json', judge: 'comic-gag-judge' } as const;

type Context = Record<string, unknown> & { comic?: Record<string, unknown> & { genreOptions?: GenreOption[] } };

/** `--check --file`: lint a gags file against a packet's context.json, outside any run. */
function checkFile(cwd: string, opts: GagsOpts): void {
  const read = (path: string) => {
    const p = resolve(cwd, path);
    if (!existsSync(p)) throw new UserError(`No such file: ${p}`);
    return JSON.parse(readFileSync(p, 'utf8')) as unknown;
  };
  if (!opts.context) throw new UserError('--file needs --context (the packet\'s context.json).', 2, { code: 'USAGE' });
  const ctx = read(opts.context) as { genreOptions?: GenreOption[] };
  const option = ctx.genreOptions?.find((g) => g.pitches?.length);
  if (!option?.pitches) throw new UserError('The context offers no genre with pitches.');
  const evidence = (opts.evidence ?? []).map((f) => readFileSync(resolve(cwd, f), 'utf8')).join('\n');
  const problems = gagProblems(read(opts.file!), option.pitches, option.memeList ?? [], evidence || undefined);
  const listed = problems.map((p) => `  ${p.where}: ${p.problem}`).join('\n');
  emit(opts, { ok: !problems.length, problems }, () => (problems.length ? `The gags file has problems:\n${listed}` : 'The gags file looks good.'));
  if (problems.length) process.exitCode = 1;
}

export function comicGagsCmd(cwd: string, opts: GagsOpts): void {
  if (opts.file) {
    if (!opts.check) throw new UserError('--file goes with --check.', 2, { code: 'USAGE' });
    return checkFile(cwd, opts);
  }
  const repo = repository(cwd);
  const run: Run = findRun(repo.gitDir, opts.run);
  assertRunOwner(run, repo.root, repo.branch);
  const ctx = readJson<Context>(run, 'context.json') ?? {};
  const options = ctx.comic?.genreOptions ?? [];
  const option = options.find((g) => g.pitches?.length);
  if (!option?.pitches) throw new UserError(`Run ${run.id} offers no genre with pitches; write comic.json as the packet says.`);
  const raw = readJson<unknown>(run, GAG_FILES.gags);
  if (raw === undefined) throw new UserError(`Write the gags to ${join(run.dir, GAG_FILES.gags)} first.`);
  const description = readText(run, 'final-body.md') ?? readText(run, 'body.md') ?? '';
  const title = readText(run, 'title.txt')?.trim();
  const evidence = [title ?? '', description, readText(run, 'changes.patch') ?? ''].join('\n');
  const problems = gagProblems(raw, option.pitches, option.memeList ?? [], evidence);
  const listed = problems.map((p) => `  ${p.where}: ${p.problem}`).join('\n');
  if (opts.check) {
    emit(opts, { ok: !problems.length, problems }, () => (problems.length ? `${GAG_FILES.gags} has problems:\n${listed}` : `${GAG_FILES.gags} looks good.`));
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (problems.length) throw new UserError(`${GAG_FILES.gags} has problems:\n${listed}`);
  const file = raw as GagsFile;
  const gags = file.gags;
  const scores = readJson<unknown>(run, GAG_FILES.scores);
  const scoreIssues = scores === undefined ? undefined : scoreProblems(scores, gags);
  if (scores === undefined || scoreIssues!.length) {
    // Judge: a fresh subagent sees the PR and the gags, never the author's notes or the anchor.
    const dir = join(run.dir, GAG_FILES.judge);
    mkdirSync(dir, { recursive: true });
    const packet = join(dir, 'instructions.md');
    writeFileSync(
      packet,
      gagJudgePrompt({
        description,
        title,
        gags,
        pitches: option.pitches,
        memes: option.memeList ?? [],
        out: join(run.dir, GAG_FILES.scores),
      }),
    );
    const spawn = `${scoreIssues?.length ? `The scores file has problems (${scoreIssues.map((p) => p.where).join(', ')}); judge again. ` : ''}Start ONE fresh subagent (not a fork; not the comic author) whose whole instruction is ${packet}. When it reports, run: tracetoon comic gags --run ${run.id}`;
    emit(opts, { run: run.id, stage: 'judge', packet, spawn }, () => spawn);
    return;
  }
  const pick = pickGag(file, scores as GagJudging, option.pitches);
  const genreOptions = options.map((g) => (g === option ? { ...g, pick } : g));
  writeJson(run, 'context.json', { ...ctx, comic: { ...(ctx.comic ?? {}), genreOptions } });
  const next = `Picked ${pick.gag.id} (ranked ${pick.rank} of ${gags.length}; the blind judge ${pick.recovered ? 'recovered' : 'did NOT recover'} the PR link${pick.gag.meme ? `; meme ${pick.gag.meme}` : ''}). Run: tracetoon comic packet --run ${run.id}`;
  emit(opts, { run: run.id, stage: 'picked', pick: { gag: pick.gag.id, pitch: pick.pitch.id, meme: pick.gag.meme ?? null, rank: pick.rank, recovered: pick.recovered }, judged: pick.judged, next }, () => next);
}

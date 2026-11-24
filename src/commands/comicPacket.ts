/**
 * `tracetoon comic packet`: writes the comic author's packet for a run and
 * says how to hand it to one fresh subagent that loads the draw-cartoon skill.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.ts';
import { genreCatalog } from '../comic/genreFile.ts';
import { genreOptions, type GenreOption } from '../comic/genres.ts';
import { castHint } from '../comic/casting.ts';
import { comicPacketFiles, PACKET_FILES } from '../comic/packet.ts';
import type { ComicSummary } from '../comic/types.ts';
import { skillDir } from '../contribution/skillSettings.ts';
import { assertRunOwner, findRun, readJson, readText, type Run } from '../run.ts';
import { DRAW_CARTOON_REFERENCES, DRAW_CARTOON_SKILL } from '../skills.ts';
import { repository } from '../workflow/state.ts';
import { emit, UserError, type OutOpts } from './output.ts';
import { runBriefText } from './query.ts';

export { DRAW_CARTOON_SKILL };

/**
 * The files the author follows: the draw-cartoon skill installed beside this
 * runtime's skill, or else the comic references of the main skill.
 */
export function comicSkillFiles(dir = skillDir()): string[] {
  if (!dir) return [];
  const sibling = join(dirname(dir), DRAW_CARTOON_SKILL);
  if (existsSync(join(sibling, 'SKILL.md'))) return [join(sibling, 'SKILL.md')];
  return DRAW_CARTOON_REFERENCES.map((f) => join(dir, 'references', f)).filter((p) => existsSync(p));
}

interface RunContext {
  comic?: {
    genreOptions?: GenreOption[];
    recentComics?: ComicSummary[];
    recentStyles?: string[];
  };
}

export interface PacketOpts extends OutOpts {
  run?: string;
  genre?: string;
}

export function comicPacketCmd(cwd: string, opts: PacketOpts): void {
  const repo = repository(cwd);
  const run: Run = findRun(repo.gitDir, opts.run);
  assertRunOwner(run, repo.root, repo.branch);
  const description = readText(run, 'final-body.md') ?? readText(run, 'body.md');
  if (!description?.trim())
    throw new UserError(
      `Write the PR description first (${join(run.dir, 'body.md')}); the comic is drawn from it.`,
    );
  const brief = runBriefText(run, repo.root);
  if (!brief)
    throw new UserError(
      `Run ${run.id} has no evidence graph; refresh it with \`tracetoon digest --run ${run.id}\`.`,
    );
  const config = loadConfig(repo.root);
  const ctx = readJson<RunContext>(run, 'context.json');
  const pinnedGenre = config.genre && config.genre !== 'auto' ? config.genre.trim() : undefined;
  const catalog = genreCatalog(repo.root);
  const asked = opts.genre?.trim();
  const genres = asked
    ? genreOptions([], { pinned: asked, catalog, seed: `${repo.root} ${repo.branch} ${run.id}` })
    : (ctx?.comic?.genreOptions ??
      genreOptions(
        (ctx?.comic?.recentComics ?? []).flatMap((c) => (c.genre ? [c.genre] : [])),
        { seed: `${repo.root} ${repo.branch}`, pinned: pinnedGenre, catalog },
      ));
  const hint = castHint(`${repo.root} ${repo.branch} ${run.id}`);
  const skillFiles = comicSkillFiles();
  if (!skillFiles.length)
    throw new UserError(
      `Can't find the ${DRAW_CARTOON_SKILL} skill or the comic references next to this runtime; reinstall with tracetoon setup.`,
    );
  const patch = join(run.dir, 'changes.patch');
  const files = comicPacketFiles({
    brief,
    description,
    genres,
    recentComics: ctx?.comic?.recentComics,
    ...(hint ? { castHint: hint } : {}),
    recentStyles: ctx?.comic?.recentStyles,
    ...(config.style && config.style !== 'auto' ? { pinnedStyle: config.style } : {}),
    ...(pinnedGenre ? { pinnedGenre } : {}),
    skillFiles,
    ...(existsSync(patch) ? { patchPath: patch } : {}),
    out: { comic: join(run.dir, 'comic.json'), design: join(run.dir, 'comic-design.json') },
    checkCommand: `tracetoon comic check --run ${run.id}`,
  });
  const dir = join(run.dir, 'comic-packet');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const packet = join(dir, PACKET_FILES.instructions);
  const spawn = `Start ONE fresh subagent (not a fork; no PR or drafting context) whose whole instruction is ${packet}. When it reports that comic.json passes the check, run: tracetoon comic art --run ${run.id}`;
  emit(
    opts,
    {
      run: run.id,
      packet,
      files: Object.keys(files).map((f) => join(dir, f)),
      skillFiles,
      genres: genres.map((g) => g.id),
      result: join(run.dir, 'comic.json'),
      spawn,
    },
    () => spawn,
  );
}

/** `tracetoon genre list` and `genre check`: the comic genres available here and genre files. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadGenreCatalog,
  parseGenreFile,
  repoGenresDir,
  userGenresDir,
  type GenreFileProblem,
} from '../comic/genreFile.ts';
import { git } from '../util/exec.ts';
import { emit, UserError, type OutOpts } from './output.ts';

function repoRoot(cwd: string): string | undefined {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  return top.ok ? top.stdout.trim() : undefined;
}

const problemLine = (p: GenreFileProblem) =>
  `  ${p.severity === 'warning' ? 'warning: ' : ''}${p.where}: ${p.problem}`;

/** Every genre a comic can use here, with where each came from, and any broken genre files. */
export function genreListCmd(cwd: string, opts: OutOpts): void {
  const root = repoRoot(cwd);
  const { genres, files } = loadGenreCatalog(root);
  const invalid = files.filter((f) => !f.genre);
  const folders = {
    user: userGenresDir(),
    ...(root ? { repo: repoGenresDir(root) } : {}),
  };
  emit(
    opts,
    {
      genres: genres.map((g) => ({
        id: g.id,
        name: g.name,
        source: g.source ?? 'built-in',
        ...(g.path ? { path: g.path } : {}),
      })),
      invalid: invalid.map((f) => ({ path: f.path, source: f.source, problems: f.problems })),
      folders,
    },
    () =>
      [
        ...genres.map(
          (g) =>
            `${g.id.padEnd(20)} ${g.name}${g.source && g.source !== 'built-in' ? `  (${g.source}: ${g.path})` : ''}`,
        ),
        ...invalid.flatMap((f) => [
          `Skipped ${f.path}:`,
          ...f.problems.map(problemLine),
        ]),
        `Add a genre: put a genre file in ${folders.user}${'repo' in folders ? ` or ${folders.repo}` : ''}; check it with tracetoon genre check <file>.`,
      ].join('\n'),
  );
}

/** Validates one genre file; exit 1 when it has errors (warnings alone pass). */
export function genreCheckCmd(cwd: string, file: string, opts: OutOpts): void {
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new UserError(`No such file: ${path}`);
  const { genre, problems } = parseGenreFile(readFileSync(path, 'utf8'), { path });
  const ok = !!genre;
  emit(opts, { ok, path, ...(genre ? { id: genre.id, name: genre.name } : {}), problems }, () =>
    [
      ...problems.map(problemLine),
      ok ? `${path}: genre "${genre!.id}" looks good.` : `${path}: fix the problems above.`,
    ].join('\n'),
  );
  if (!ok) process.exitCode = 1;
}

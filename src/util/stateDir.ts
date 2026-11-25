import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

/** The state folder of a linked worktree or submodule, at its root. */
export const STATE_FOLDER = '.tracetoon';

/**
 * Where Tracetoon keeps a checkout's runs, task lock and caches.
 *
 * In an ordinary clone the git dir is inside the checkout, so state lives in
 * `<root>/.git/tracetoon`, where git never looks. A linked worktree's git dir
 * (`<main>/.git/worktrees/<name>`) and a submodule's (`.git/modules/<name>`)
 * are outside the checkout, where an agent sandboxed to that checkout can't
 * write the drafts it has to put in the run folder. There, state lives in
 * `<root>/.tracetoon`, which ignores itself (see `ensureStateDir`).
 */
export function stateDir(root: string, gitDir: string): string {
  const inside = relative(resolve(root), resolve(gitDir));
  return inside && !inside.startsWith('..') && !isAbsolute(inside)
    ? join(gitDir, 'tracetoon')
    : join(root, STATE_FOLDER);
}

/**
 * Create the state folder. One inside a checkout gets a `.gitignore` of `*`, so
 * `git status` and `git add -A` never pick up a run, without touching the
 * repository's own ignore files.
 */
export function ensureStateDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (basename(dir) === STATE_FOLDER && !existsSync(ignore))
    writeFileSync(ignore, '# Tracetoon scratch: runs and caches, never committed.\n*\n', 'utf8');
  return dir;
}

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { makeRepo, tempDir } from './helpers.ts';
import { git } from '../src/util/exec.ts';
import { stateDir, STATE_FOLDER } from '../src/util/stateDir.ts';
import { privateRepoPath } from '../src/util/repoFiles.ts';
import { beginTask, repository, tasks } from '../src/workflow/state.ts';
import { repoRootOfRun } from '../src/workflow/checks.ts';
import { prTruth } from '../src/git/pr.ts';

describe('where a checkout keeps its runs', () => {
  test('an ordinary clone keeps state in its git dir', () => {
    expect(stateDir('/w/repo', '/w/repo/.git')).toBe(join('/w/repo/.git', 'tracetoon'));
  });

  test('a git dir outside the checkout (linked worktree, submodule) keeps state in the checkout', () => {
    expect(stateDir('/w/repo-feature', '/w/repo/.git/worktrees/repo-feature')).toBe(
      join('/w/repo-feature', STATE_FOLDER),
    );
    expect(stateDir('/w/super/lib', '/w/super/.git/modules/lib')).toBe(
      join('/w/super/lib', STATE_FOLDER),
    );
  });

  test('the state folder is private to diffs and briefs', () => {
    expect(privateRepoPath(`${STATE_FOLDER}/runs/20260101-000000/body.md`)).toBe(true);
    expect(privateRepoPath('src/tracetoon/runs.ts')).toBe(false);
  });

  test('a task begun in a linked worktree writes its run inside that worktree, and git ignores it', () => {
    const repo = makeRepo();
    const main = beginTask(repo.root, { session: 'main' });
    const worktree = join(tempDir('tracetoon-worktree-'), 'checkout');
    expect(git(repo.root, ['worktree', 'add', '-qb', 'linked', worktree]).ok).toBe(true);

    const linked = beginTask(worktree, { session: 'linked' });
    const { stateDir: state, root } = repository(worktree);
    expect(state).toBe(join(root, STATE_FOLDER));
    // The run folder is inside the worktree, so an agent sandboxed to it can write drafts.
    expect(relative(root, linked.run.dir).startsWith('..')).toBe(false);
    writeFileSync(join(linked.run.dir, 'body.md'), 'draft\n');

    // The folder ignores itself: no untracked files, and the PR diff never sees it.
    expect(readFileSync(join(state, '.gitignore'), 'utf8')).toContain('*');
    expect(git(worktree, ['status', '--porcelain', '--untracked-files=all']).stdout).toBe(
      '',
    );
    expect(prTruth(worktree, { noGh: true }).files.map((f) => f.path)).toEqual([]);

    // Runs stay apart per checkout and still map back to their worktree.
    expect(tasks(state).map((t) => t.run.id)).toEqual([linked.run.id]);
    expect(tasks(repository(repo.root).stateDir).map((t) => t.run.id)).toEqual([
      main.run.id,
    ]);
    expect(repoRootOfRun(linked.run)).toBe(root);
    expect(repoRootOfRun(main.run)).toBe(repository(repo.root).root);
    expect(existsSync(join(repo.root, STATE_FOLDER))).toBe(false);
  });
});

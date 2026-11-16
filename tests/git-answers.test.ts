import { expect, test } from 'bun:test';
import { forgetGitAnswers, git, run, withGitAnswers } from '../src/util/exec.ts';
import { makeRepo } from './helpers.ts';

// The profile collector counts every git process this one starts.
const counters = () =>
  (globalThis as any)[Symbol.for('tracetoon.profile-state/v1')].counters as Record<
    string,
    number
  >;
const spawned = (action: () => void) => {
  const before = counters()['subprocess.git'] ?? 0;
  action();
  return (counters()['subprocess.git'] ?? 0) - before;
};
const branch = (root: string) =>
  git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();

test('outside a hook event or command every git question starts git', () => {
  const repo = makeRepo();
  expect(spawned(() => [branch(repo.root), branch(repo.root)])).toBe(2);
});

test('within one scope a read-only question is answered once', () => {
  const repo = makeRepo();
  withGitAnswers(() => {
    expect(
      spawned(() => {
        for (let i = 0; i < 3; i++) {
          expect(branch(repo.root)).toBe('feature');
          git(repo.root, ['config', '--get', 'user.name']);
          git(repo.root, ['remote', '-v']);
        }
      }),
    ).toBe(3);
    // Reads that are not reused still don't drop the reused answers.
    git(repo.root, ['status', '--porcelain']);
    expect(spawned(() => branch(repo.root))).toBe(0);
  });
  // Leaving the scope forgets everything.
  expect(spawned(() => branch(repo.root))).toBe(1);
});

test('a git write, any other program or an explicit forget drops the answers', () => {
  const repo = makeRepo();
  withGitAnswers(() => {
    expect(branch(repo.root)).toBe('feature');
    git(repo.root, ['checkout', '-q', 'main']);
    expect(branch(repo.root)).toBe('main');
    git(repo.root, ['config', 'user.name', 'Someone']);
    expect(git(repo.root, ['config', '--get', 'user.name']).stdout.trim()).toBe(
      'Someone',
    );

    // Another program (a user's check, gh) may move the branch behind git()'s back.
    run(process.execPath, ['-e', '0']);
    expect(spawned(() => branch(repo.root))).toBe(1);
    forgetGitAnswers();
    expect(spawned(() => branch(repo.root))).toBe(1);
  });
});

test('questions with input or extra environment are never reused', () => {
  const repo = makeRepo();
  withGitAnswers(() => {
    const ask = () =>
      git(repo.root, ['rev-parse', 'HEAD'], undefined, { GIT_DIR: '.git' });
    expect(spawned(() => [ask(), ask()])).toBe(2);
  });
});

test('a scope around async work stays open until the work finishes', async () => {
  const repo = makeRepo();
  await withGitAnswers(async () => {
    branch(repo.root);
    await new Promise((r) => setTimeout(r, 5));
    expect(spawned(() => branch(repo.root))).toBe(0);
  });
  expect(spawned(() => branch(repo.root))).toBe(1);
});

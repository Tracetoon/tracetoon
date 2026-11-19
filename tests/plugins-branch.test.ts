import { describe, expect, test } from 'bun:test';
import { pluginsCommit, refused } from '../.github/scripts/plugins-branch.ts';
import { git } from '../src/util/exec.ts';
import { makeRepo } from './helpers.ts';

const g = (cwd: string, ...args: string[]) => {
  const r = git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const manifest = (version: string) =>
  JSON.stringify({ name: 'tracetoon', version }) + '\n';

/** A tagged source commit whose plugins/ folder is at `version`. */
function tagRelease(repo: ReturnType<typeof makeRepo>, version: string) {
  repo.commit('plugins/claude/.claude-plugin/plugin.json', manifest(version), 'claude');
  repo.commit('plugins/agent/plugin.json', manifest(version), 'agent');
  repo.commit('plugins/claude/README.md', `# Tracetoon ${version}\n`, 'readme');
  repo.commit('src/cli.ts', `// ${version}\n`, `Prepare ${version}`);
  g(repo.root, 'tag', `v${version}`);
}

describe('plugins branch commits', () => {
  test('each release commits only plugins/ as the root and fast-forwards', () => {
    const repo = makeRepo();
    tagRelease(repo, '1.0.0');
    const first = pluginsCommit({ repo: repo.root, tag: 'v1.0.0', version: '1.0.0' });
    expect(first.created).toBe(true);
    const files = g(repo.root, 'ls-tree', '-r', '--name-only', first.commit).split('\n');
    expect(files.sort()).toEqual([
      'agent/plugin.json',
      'claude/.claude-plugin/plugin.json',
      'claude/README.md',
    ]);
    // No parent: none of the source history comes along.
    expect(g(repo.root, 'rev-list', '--parents', '-n', '1', first.commit)).toBe(
      first.commit,
    );

    tagRelease(repo, '1.0.1');
    const second = pluginsCommit({
      repo: repo.root,
      tag: 'v1.0.1',
      version: '1.0.1',
      previous: first.commit,
    });
    expect(
      g(repo.root, 'rev-list', '--parents', '-n', '1', second.commit).split(' '),
    ).toEqual([second.commit, first.commit]);
    // Running it again for the same release changes nothing.
    expect(
      pluginsCommit({
        repo: repo.root,
        tag: 'v1.0.1',
        version: '1.0.1',
        previous: second.commit,
      }),
    ).toEqual({ commit: second.commit, created: false });
  });

  test('refuses packages at another version', () => {
    const repo = makeRepo();
    tagRelease(repo, '1.0.0');
    expect(() =>
      pluginsCommit({ repo: repo.root, tag: 'v1.0.0', version: '1.0.1' }),
    ).toThrow('not 1.0.1');
  });

  test('refuses scripts, binaries and executable files', () => {
    expect(
      refused(
        [
          '100644 blob a\tclaude/README.md',
          '100644 blob b\tclaude/assets/tracetoon.png',
          '100644 blob c\tclaude/LICENSE',
          '100755 blob d\tclaude/hooks/run.json',
          '100644 blob e\tclaude/bin/tracetoon.mjs',
          '120000 blob f\tskills',
        ].join('\n'),
      ),
    ).toEqual([
      'claude/hooks/run.json (100755)',
      'claude/bin/tracetoon.mjs (100644)',
      'skills (120000)',
    ]);
  });
});

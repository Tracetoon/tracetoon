/**
 * Publish the thin plugin packages on the `plugins` branch.
 *
 * Catalogs that review plugins (the Anthropic directory, Cursor, Copilot's
 * awesome-copilot) want a tree with nothing but the plugin: no source, no
 * package-manager files above it, no binaries. main keeps plugins/ current
 * (scripts/plugins.ts); this commits exactly that folder, taken from the tag,
 * as the root of one new commit on `plugins`, so each package sits at
 * claude/, cursor/, codex/, codex-directory/ and agent/.
 *
 * The previous `plugins` head is the only parent, so the branch only
 * fast-forwards (never forced). The commit is also tagged plugins/<tag>: an
 * immutable ref for catalogs that review a tag and commit (awesome-copilot).
 * The release workflow runs it only once npm serves every package the
 * packages pin.
 *
 *   bun .github/scripts/plugins-branch.ts <tag> [--push]
 */
import { git } from '../../src/util/exec.ts';

export const BRANCH = 'plugins';
export const tagFor = (tag: string) => `plugins/${tag}`;

const IDENTITY = {
  GIT_AUTHOR_NAME: 'github-actions[bot]',
  GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
};

function must(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = git(repo, args, undefined, env);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Files a package may hold: Markdown, JSON, a PNG icon and the licence, none executable. */
export function refused(lsTree: string): string[] {
  return lsTree
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const mode = meta!.split(' ')[0];
      const name = path!.split('/').pop()!;
      const kind = /\.(md|json|png)$/.test(name) || name === 'LICENSE';
      return mode === '100644' && kind ? undefined : `${path} (${mode})`;
    })
    .filter((x): x is string => !!x);
}

export interface PluginsCommit {
  commit: string;
  created: boolean;
}

/** Build the `plugins` commit for `tag`. `previous` is the branch head, if it exists. */
export function pluginsCommit(opts: {
  repo: string;
  tag: string;
  version: string;
  previous?: string;
}): PluginsCommit {
  const { repo, tag, version, previous } = opts;
  const source = must(repo, ['rev-parse', '--verify', `${tag}^{commit}`]);
  const tree = must(repo, ['rev-parse', '--verify', `${source}:plugins`]);
  for (const manifest of ['claude/.claude-plugin/plugin.json', 'agent/plugin.json']) {
    const v = JSON.parse(must(repo, ['show', `${source}:plugins/${manifest}`])).version;
    if (v !== version)
      throw new Error(`${tag} has plugins/${manifest} at ${v}, not ${version}.`);
  }
  const bad = refused(must(repo, ['ls-tree', '-r', tree]));
  if (bad.length)
    throw new Error(
      `plugins/ in ${tag} holds files no package may ship: ${bad.join(', ')}`,
    );
  // Re-running the workflow for a release already on the branch is a no-op.
  if (previous && must(repo, ['rev-parse', `${previous}^{tree}`]) === tree)
    return { commit: previous, created: false };
  const commit = must(
    repo,
    [
      'commit-tree',
      tree,
      ...(previous ? ['-p', previous] : []),
      '-m',
      `Plugins ${tag}\n\nThe plugin packages from plugins/ at ${tag} (${source}).`,
    ],
    { ...process.env, ...IDENTITY },
  );
  return { commit, created: true };
}

if (import.meta.main) {
  const [tag] = process.argv.slice(2);
  if (!tag || !/^v\d/.test(tag))
    throw new Error('usage: plugins-branch.ts <tag> [--push]');
  const repo = process.cwd();
  // The branch may not exist yet (the first release creates it). When it does,
  // a failed fetch must stop here rather than look like a first release.
  const exists =
    must(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${BRANCH}`]) !== '';
  if (exists)
    must(repo, [
      'fetch',
      '--refmap=',
      'origin',
      `+refs/heads/${BRANCH}:refs/tracetoon/plugins-head`,
    ]);
  const previous = exists
    ? must(repo, ['rev-parse', 'refs/tracetoon/plugins-head'])
    : undefined;
  const result = pluginsCommit({ repo, tag, version: tag.slice(1), previous });
  console.log(
    result.created
      ? `plugins: ${result.commit} (${tag} on top of ${previous ?? 'nothing'})`
      : `plugins: already at ${tag} (${result.commit})`,
  );
  if (!process.argv.includes('--push')) console.log('plugins: checked, not pushed');
  else {
    if (result.created)
      must(repo, ['push', 'origin', `${result.commit}:refs/heads/${BRANCH}`]);
    const tagged = must(repo, [
      'ls-remote',
      '--tags',
      'origin',
      `refs/tags/${tagFor(tag)}`,
    ]);
    if (!tagged)
      must(repo, ['push', 'origin', `${result.commit}:refs/tags/${tagFor(tag)}`]);
  }
}

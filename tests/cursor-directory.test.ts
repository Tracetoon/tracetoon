/**
 * cursor.directory ("Submit a plugin" → Auto (GitHub)) builds a listing from
 * the repository's default branch. This mirrors its discovery rules
 * (github.com/cursor/community-plugins, packages/plugins/src/github.ts,
 * parseGitHubRepo) over the files committed here, so a change that would make
 * the scan pick up the wrong package fails in CI instead of in the form:
 *
 * - Root manifest: the first of ROOT_MANIFESTS that exists.
 * - Plugin folders: the root, each marketplace `plugins[].source` as written
 *   (a leading `./` is kept, so its file-list lookups miss, while its direct
 *   file fetches still resolve), and every `<dir>/.cursor-plugin/plugin.json`.
 * - Skills, rules, agents and commands are matched in the file list; MCP
 *   (`.mcp.json`, then `mcp.json`) and `hooks/hooks.json` are fetched by path.
 * - Components are deduplicated by type and name; the first one found wins.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, posix } from 'node:path';
import pkg from '../package.json';

const root = join(import.meta.dir, '..');
const ROOT_MANIFESTS = [
  '.plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.cursor-plugin/marketplace.json',
];

/** The working tree's files, as GitHub's tree listing would show them once committed. */
function tree(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => existsSync(join(root, p)));
}

/** raw.githubusercontent.com resolves `./` segments; the file list doesn't. */
const fetchFile = (path: string): string | null => {
  const p = join(root, normalize(path));
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

/** packages/plugins/src/slug.ts. */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['".]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

interface Found {
  type: string;
  name: string;
  from: string;
}

function scan(files: string[]): Found[] {
  let manifest: { plugins?: { source?: unknown }[] } = {};
  for (const mp of ROOT_MANIFESTS) {
    const content = fetchFile(mp);
    if (content) {
      manifest = JSON.parse(content);
      break;
    }
  }
  const dirs = new Set<string>();
  for (const entry of manifest.plugins ?? []) {
    const source = entry.source;
    if (typeof source === 'string' && source && !source.includes('..'))
      dirs.add(`${source.replace(/^\/+|\/+$/g, '')}/`);
  }
  for (const f of files) {
    const m = f.match(/^(.+)\/\.cursor-plugin\/plugin\.json$/);
    if (m) dirs.add(`${m[1]}/`);
  }
  const found: Found[] = [];
  for (const prefix of ['', ...dirs]) {
    // The scanner builds these patterns from the raw prefix, unescaped.
    const listed = (pattern: string) =>
      files.filter((f) => new RegExp(`^${prefix}${pattern}`).test(f));
    for (const f of listed('skills/[^/]+/SKILL\\.md$'))
      found.push({ type: 'skill', name: f.split('/').at(-2)!, from: prefix });
    for (const f of listed('rules/.*\\.mdc$'))
      found.push({ type: 'rule', name: f, from: prefix });
    for (const f of listed('agents/.*\\.md$'))
      found.push({ type: 'agent', name: f, from: prefix });
    for (const f of listed('commands/.*\\.md$'))
      found.push({ type: 'command', name: f, from: prefix });
    for (const mcpPath of [`${prefix}.mcp.json`, `${prefix}mcp.json`]) {
      const content = fetchFile(mcpPath);
      if (!content) continue;
      const config = JSON.parse(content);
      for (const name of Object.keys(config.mcpServers ?? config))
        found.push({ type: 'mcp_server', name, from: prefix });
      break;
    }
    if (fetchFile(`${prefix}hooks/hooks.json`))
      found.push({
        type: 'hook',
        name: `hooks${prefix ? `-${slugify(prefix)}` : ''}`,
        from: prefix,
      });
  }
  const seen = new Set<string>();
  return found.filter((c) => {
    const key = `${c.type}:${slugify(c.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe('cursor.directory GitHub scan', () => {
  const found = scan(tree());
  const folder = (from: string) => posix.normalize(from).replace(/\/$/, '');

  test('finds exactly the Cursor package: two skills, one MCP server, one hooks file', () => {
    // The main skill and the instruction-only draw-cartoon skill beside it.
    expect(found.map((c) => c.type).sort()).toEqual(['hook', 'mcp_server', 'skill', 'skill']);
    for (const c of found) expect(folder(c.from)).toBe('plugins/cursor');
  });

  test('plugins/cursor is the only folder the scan treats as a Cursor plugin', () => {
    const manifests = tree().filter((p) =>
      /(^|\/)\.cursor-plugin\/plugin\.json$/.test(p),
    );
    expect(manifests).toEqual(['plugins/cursor/.cursor-plugin/plugin.json']);
  });

  test('the components it lists run this version from npm', () => {
    const mcp = JSON.parse(readFileSync(join(root, 'plugins/cursor/mcp.json'), 'utf8'));
    expect(mcp.mcpServers.tracetoon.args).toContain(`tracetoon@${pkg.version}`);
    const skill = readFileSync(
      join(root, 'plugins/cursor/skills/tracetoon/SKILL.md'),
      'utf8',
    );
    expect(skill).toContain(`npx -y tracetoon@${pkg.version}`);
    expect(skill).not.toContain('bin/tracetoon');
  });
});

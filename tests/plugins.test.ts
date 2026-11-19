/**
 * The thin plugin packages (scripts/plugins.ts) against each catalog's rules,
 * as read 2026-11-18 and as the Anthropic directory's validator enforced them
 * on rc.38. docs/agents/submissions.md cites the sources.
 */
import { describe, expect, test } from 'bun:test';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import pkg from '../package.json';
import {
  NPX_ARGS,
  OUT,
  PR_COMMAND_PATTERN,
  pluginFiles,
  stalePlugins,
} from '../scripts/plugins.ts';
import { PR_COMMAND_GLOBS } from '../src/hook/prCommands.ts';
import { writesPr } from '../src/hook/prHook.ts';

const root = join(import.meta.dir, '..');
const files = pluginFiles();
const pkgFiles = (dir: string) =>
  [...files.keys()].filter((p) => p.startsWith(`${OUT}/${dir}/`));
const text = (path: string) => files.get(path)!.toString();
const parse = (path: string) => JSON.parse(text(path));
const RUNTIME = ['npx', ...NPX_ARGS].join(' ');

test('plugins/ matches the generator', () => {
  expect(stalePlugins()).toEqual([]);
});

describe('every package', () => {
  test.each([
    'claude',
    'claude-directory',
    'cursor',
    'codex',
    'codex-directory',
    'agent',
  ])(
    '%s holds only Markdown, JSON, a PNG icon and the licence, and executes nothing',
    (dir) => {
      const paths = pkgFiles(dir);
      expect(paths.length).toBeGreaterThan(5);
      for (const path of paths) {
        const name = path.split('/').pop()!;
        expect({ path, ok: /\.(md|json|png)$/.test(name) || name === 'LICENSE' }).toEqual(
          {
            path,
            ok: true,
          },
        );
        const data = files.get(path)!;
        if (name.endsWith('.png')) {
          expect(Buffer.from(data).subarray(1, 4).toString()).toBe('PNG');
          continue;
        }
        const body = data.toString();
        expect(body.includes('\0')).toBe(false);
        expect(body.startsWith('#!')).toBe(false);
        // Non-image files stay under the Claude directory's 256 KiB hold limit.
        expect(Buffer.byteLength(body)).toBeLessThan(256 * 1024);
        expect(
          /^(package(-lock)?\.json|\.npmrc|bunfig\.toml|yarn\.lock|pnpm-.*)$/.test(name),
        ).toBe(false);
      }
      // The README the Claude directory requires has at least 40 words.
      expect(text(`${OUT}/${dir}/README.md`).split(/\s+/).length).toBeGreaterThan(40);
    },
  );

  test('the committed tree has no symlinks', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        const st = lstatSync(path);
        if (st.isSymbolicLink()) return [relative(root, path)];
        return st.isDirectory() ? walk(path) : [];
      });
    expect(walk(join(root, OUT))).toEqual([]);
  });

  test('every runtime call is npx at exactly this version', () => {
    for (const [path, data] of files) {
      if (!path.endsWith('.json')) continue;
      const body = data.toString();
      expect(body.includes('@latest')).toBe(false);
      for (const m of body.matchAll(/tracetoon@[^\s"]+/g))
        expect(m[0]).toBe(`tracetoon@${pkg.version}`);
    }
    for (const dir of ['claude', 'cursor', 'codex', 'agent']) {
      const mcp = parse(`${OUT}/${dir}/${dir === 'claude' ? '.mcp.json' : 'mcp.json'}`);
      expect(mcp.mcpServers.tracetoon).toEqual({
        command: 'npx',
        args: [...NPX_ARGS, 'mcp'],
      });
    }
  });

  test('each package carries the same thin skill, pinned to this version', () => {
    const skills = ['claude', 'cursor', 'codex', 'agent'].map((d) =>
      text(`${OUT}/${d}/skills/tracetoon/SKILL.md`),
    );
    expect(new Set(skills).size).toBe(1);
    // Skills-only packages carry the same skill plus one paragraph about the hook.
    const skillOnly = ['claude-directory', 'codex-directory'].map((d) =>
      text(`${OUT}/${d}/skills/tracetoon/SKILL.md`),
    );
    expect(new Set(skillOnly).size).toBe(1);
    expect(skillOnly[0]).toContain('came without hooks');
    expect(skills[0]).not.toContain('came without hooks');
    expect(skills[0]).toContain(`npx -y tracetoon@${pkg.version}`);
    expect(skills[0]).not.toContain('bin/tracetoon');
    expect(skills[0]).not.toContain('<!-- runtime:');
    expect(skills[0]).toMatch(/^compatibility: Requires Node\.js 18/m);
  });
});

describe('Claude Code (Anthropic plugin directory)', () => {
  const dir = `${OUT}/claude`;
  test('plugin.json uses only fields Claude Code or the directory reads', () => {
    const allowed = [
      'name',
      'version',
      'description',
      'author',
      'homepage',
      'repository',
      'license',
      'keywords',
      'icon',
      'documentationUrl',
      'supportUrl',
      'network',
    ];
    const manifest = parse(`${dir}/.claude-plugin/plugin.json`);
    expect(Object.keys(manifest).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(manifest.version).toBe(pkg.version);
    expect(files.has(`${dir}/${manifest.icon.replace(/^\.\//, '')}`)).toBe(true);
    // Only plugin.json may sit in .claude-plugin.
    expect(pkgFiles('claude').filter((p) => p.includes('/.claude-plugin/'))).toEqual([
      `${dir}/.claude-plugin/plugin.json`,
    ]);
  });

  test('hooks use documented events, npx only, and never block outside PR creation', () => {
    const { hooks } = parse(`${dir}/hooks/hooks.json`);
    expect(Object.keys(hooks).sort()).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
    ]);
    for (const [event, groups] of Object.entries<any[]>(hooks))
      for (const group of groups)
        for (const h of group.hooks) {
          expect(h.type).toBe('command');
          expect(
            h.command.startsWith(
              `${RUNTIME} hook plugin --agent claude --event ${event}`,
            ),
          ).toBe(true);
          // Only the PR check may wait for an answer; observation never blocks.
          if (event !== 'PreToolUse') expect(h.async).toBe(true);
        }
    const shell = hooks.PreToolUse.find((g: any) => g.matcher === 'Bash');
    expect(shell.hooks.map((h: any) => h.if)).toEqual(
      PR_COMMAND_GLOBS.map((g) => `Bash(${g})`),
    );
  });

  test('a top-level bin/ (which stops claude.ai and Cowork installs) is absent', () => {
    expect(pkgFiles('claude').some((p) => p.startsWith(`${dir}/bin/`))).toBe(false);
  });
});

describe('Anthropic plugin directory (unverified publisher)', () => {
  const dir = `${OUT}/claude-directory`;
  test('skills only: no hooks, no MCP server, no bin/', () => {
    // The directory refuses hooks of any type and local (stdio) MCP servers
    // from organizations it hasn't verified.
    const paths = pkgFiles('claude-directory');
    expect(paths.some((p) => /\/(hooks|bin)\//.test(p))).toBe(false);
    expect(paths.some((p) => /\/\.?mcp\.json$/.test(p))).toBe(false);
    expect(paths).toContain(`${dir}/skills/tracetoon/SKILL.md`);
  });
  test('plugin.json has only the fields Claude Code reads, plus the listing icon', () => {
    const manifest = parse(`${dir}/.claude-plugin/plugin.json`);
    expect(Object.keys(manifest).sort()).toEqual(
      [
        'author',
        'description',
        'homepage',
        'icon',
        'keywords',
        'license',
        'name',
        'repository',
        'version',
      ].sort(),
    );
    expect(manifest.version).toBe(pkg.version);
    expect(
      pkgFiles('claude-directory').filter((p) => p.includes('/.claude-plugin/')),
    ).toEqual([`${dir}/.claude-plugin/plugin.json`]);
  });
  test('its skill names no environment variable, key or URL (the directory holds those)', () => {
    // MCP_FORWARDS_CREDENTIAL_ENV: an env reference or "key" beside a remote URL is held for review.
    const skill = text(`${dir}/skills/tracetoon/SKILL.md`);
    expect(skill).not.toMatch(/https?:\/\//);
    expect(skill).not.toMatch(/\$env:|\$\{[A-Z_]+\}|setting a key/);
  });
  test('its README and REVIEW say there is no hook, and how to get one', () => {
    expect(text(`${dir}/README.md`)).toContain(
      '/plugin marketplace add Tracetoon/tracetoon',
    );
    expect(text(`${dir}/REVIEW.md`)).not.toContain('The hook stops it');
  });
});

describe('the PR command filter', () => {
  const glob = (g: string) =>
    new RegExp(
      `^${g
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*')}$`,
    );
  const creates = [
    'gh pr create --title x --body y',
    'cd repo && gh pr create --fill',
    'GH_TOKEN=abc gh pr create',
    '"C:/Program Files/GitHub CLI/gh.exe" pr create',
    '& gh pr new',
    "cat > a.txt <<'EOF'\nnothing\nEOF\ngh pr create --fill",
    'hub pull-request -m "Fix it"',
    'git pull-request',
    'git -C ../other pull-request',
    'git town propose',
    'git town new-pull-request',
    'git-town propose --title x',
    'gh api repos/acme/demo/pulls -f title=x -f head=f -f base=main',
    'hub api -X POST repos/acme/demo/pulls --input pr.json',
    'curl -X POST https://api.github.com/repos/acme/demo/pulls -d @pr.json',
    'iwr -method POST https://api.github.com/repos/acme/demo/pulls',
    'irm -Meth Post https://api.github.com/repos/acme/demo/pulls',
  ];
  test.each(creates)('a hook filter catches %p', (command) => {
    expect(writesPr(command)).toBe(true);
    expect(PR_COMMAND_GLOBS.some((g) => glob(g).test(command))).toBe(true);
    expect(new RegExp(PR_COMMAND_PATTERN).test(command)).toBe(true);
  });
  test('ordinary commands start no runtime', () => {
    for (const command of ['ls -la', 'git status', 'bun test', 'npm run build'])
      expect(PR_COMMAND_GLOBS.some((g) => glob(g).test(command))).toBe(false);
  });
});

describe('Cursor Marketplace', () => {
  const dir = `${OUT}/cursor`;
  test('its own manifest, a root mcp.json and version-1 hooks', () => {
    const manifest = parse(`${dir}/.cursor-plugin/plugin.json`);
    expect(manifest.name).toBe('tracetoon');
    expect(manifest.version).toBe(pkg.version);
    expect(files.has(`${dir}/${manifest.logo}`)).toBe(true);
    expect(files.has(`${dir}/mcp.json`)).toBe(true);
    expect(files.has(`${dir}/.mcp.json`)).toBe(false);
    const hooks = parse(`${dir}/hooks/hooks.json`);
    expect(hooks.version).toBe(1);
    expect(Object.keys(hooks.hooks).sort()).toEqual([
      'beforeShellExecution',
      'sessionStart',
    ]);
  });
});

describe('Agent Plugins (Codex, Copilot CLI, Kiro)', () => {
  const FIELDS = [
    '$schema',
    'name',
    'version',
    'description',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'extensions',
  ];
  test.each(['codex', 'codex-directory', 'agent'])(
    '%s/plugin.json keeps to the closed field set',
    (dir) => {
      const manifest = parse(`${OUT}/${dir}/plugin.json`);
      expect(Object.keys(manifest).filter((k) => !FIELDS.includes(k))).toEqual([]);
      expect(manifest.$schema).toContain('1.0.0');
      expect(manifest.author.name).toBe('Tracetoon');
      expect(manifest.keywords.length).toBeGreaterThan(3);
    },
  );
  test('the OpenAI directory package has no hooks and no MCP server', () => {
    const paths = pkgFiles('codex-directory');
    expect(paths.some((p) => /\/hooks\/|mcp\.json$/.test(p))).toBe(false);
    expect(text(`${OUT}/codex-directory/.codex-plugin/plugin.json`)).not.toContain(
      'mcpServers',
    );
  });
  test('Copilot hooks live under com.github.copilot and start npx directly', () => {
    const hooks = parse(`${OUT}/agent/com.github.copilot/hooks/hooks.json`);
    for (const groups of Object.values<any[]>(hooks.hooks))
      for (const g of groups)
        for (const h of g.hooks) {
          expect(h.exec).toBe('npx');
          expect(h.args.slice(0, NPX_ARGS.length)).toEqual(NPX_ARGS);
        }
  });
  test('the skill folder name matches the skill name (Agent Skills spec)', () => {
    const skill = text(`${OUT}/agent/skills/tracetoon/SKILL.md`);
    expect(skill).toMatch(/^name: tracetoon$/m);
  });
});

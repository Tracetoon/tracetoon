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
  AGENT_MCP_SCHEMA,
  AGENT_PLUGIN_SCHEMA,
  NPX_ARGS,
  OUT,
  PR_COMMAND_PATTERN,
  pluginFiles,
  PRIVACY_URL,
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

test('no package runs npx with --prefer-offline (a stale package list fails with ETARGET)', () => {
  expect(NPX_ARGS).not.toContain('--prefer-offline');
  for (const [path, body] of files)
    if (/\.json$/.test(path)) expect(body.toString()).not.toContain('--prefer-offline');
});

test('every packaged SKILL.md stays within 500 lines (Agent Skills guidance, enforced by vally)', () => {
  for (const path of [...files.keys()].filter((p) => p.endsWith('/SKILL.md')))
    expect(text(path).split('\n').length).toBeLessThanOrEqual(500);
});

test('every packaged SKILL.md has frontmatter a strict YAML parser accepts', () => {
  const skills = [...files.keys()].filter((p) => p.endsWith('/SKILL.md'));
  expect(skills.length).toBeGreaterThan(0);
  for (const path of skills) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text(path));
    const meta = Bun.YAML.parse(m?.[1] ?? '') as Record<string, unknown>;
    expect(meta.name).toBe('tracetoon');
    expect(String(meta.description)).toContain('pull request');
  }
});

describe('privacy and data handling', () => {
  const ALL = [
    'claude',
    'claude-directory',
    'cursor',
    'codex',
    'codex-directory',
    'agent',
  ];
  test('the privacy policy the packages link to is in the repository', () => {
    expect(PRIVACY_URL.endsWith('/blob/main/PRIVACY.md')).toBe(true);
    const policy = readFileSync(join(root, 'PRIVACY.md'), 'utf8');
    for (const fact of ['GitHub', 'image service', 'telemetry', '.git/tracetoon/runs'])
      expect(policy).toContain(fact);
  });
  test.each(ALL)('%s README says what leaves the machine and links the policy', (dir) => {
    const readme = text(`${OUT}/${dir}/README.md`);
    expect(readme).toContain('## What it reads');
    expect(readme).toMatch(/names and email addresses/);
    expect(readme).toContain('.git/tracetoon/runs/');
    expect(readme).toContain('## What it sends');
    expect(readme).toContain('## Privacy');
    expect(readme).toContain(PRIVACY_URL);
    expect(text(`${OUT}/${dir}/REVIEW.md`)).toContain(PRIVACY_URL);
  });
  test.each(ALL)('%s README says when Codex reviews apply on its host', (dir) => {
    const readme = text(`${OUT}/${dir}/README.md`);
    if (dir.startsWith('codex')) expect(readme).toMatch(/\(the default\s+on Codex\)/);
    else expect(readme).toContain("only if you switch Tracetoon's reviewers to it");
  });
  test('every manifest credits the author', () => {
    for (const path of [...files.keys()].filter((p) => p.endsWith('plugin.json')))
      expect(parse(path).author.name).toBe('Cassandra Chin');
  });
  test.each(['claude', 'claude-directory'])('%s plugin.json names the policy', (dir) => {
    expect(parse(`${OUT}/${dir}/.claude-plugin/plugin.json`).privacyPolicyUrl).toBe(
      PRIVACY_URL,
    );
  });
  test('no listing promises an approval step that publish does not have', () => {
    for (const dir of ALL)
      expect(text(`${OUT}/${dir}/README.md`)).not.toMatch(/you approve the PR/);
  });
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
    for (const path of [
      'claude/.mcp.json',
      'claude/mcp.json',
      'cursor/mcp.json',
      'codex/mcp.json',
      'agent/mcp.json',
    ]) {
      expect(parse(`${OUT}/${path}`).mcpServers.tracetoon).toEqual({
        type: 'stdio',
        command: 'npx',
        args: [...NPX_ARGS, 'mcp'],
      });
    }
  });

  test('every README links the install guide the packaged skill points at', () => {
    for (const d of [
      'claude',
      'claude-directory',
      'cursor',
      'codex',
      'codex-directory',
      'agent',
    ]) {
      expect(text(`${OUT}/${d}/skills/tracetoon/SKILL.md`)).toContain(
        "linked from\nthis plugin's README",
      );
      expect(text(`${OUT}/${d}/README.md`)).toContain('docs/agents/install.md');
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
      'privacyPolicyUrl',
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
        'privacyPolicyUrl',
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
    expect(skill).not.toMatch(/\$env:|\$\{[A-Z_]+\}|setting a key|TRACETOON=|gh auth/);
  });
  test('its listing names Claude Code alone, with the Claude Code result', () => {
    const { description } = parse(`${dir}/.claude-plugin/plugin.json`);
    expect(description).toContain('Claude Code session logs');
    expect(description).toContain('60 to 21 on Claude Code');
    for (const other of ['Codex', 'Cursor', 'Antigravity', 'Copilot', 'Kiro'])
      expect(description).not.toContain(other);
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

/**
 * Agent Plugins 1.0.0 (agent-plugins.org/plugin-builders/specification, the
 * standard cursor.directory calls Open Plugins), checked by hand so the tests
 * need no network and no schema library: plugin.json (§5), skills (§7.1) and
 * mcp.json (§7.2). Hooks are outside v1 and each host reads its own.
 */
describe('Agent Plugins 1.0.0 conformance', () => {
  const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
  const DIRS = [
    'claude',
    'claude-directory',
    'cursor',
    'codex',
    'codex-directory',
    'agent',
  ];
  test.each(DIRS)('%s is a conforming plugin', (dir) => {
    const manifest = parse(`${OUT}/${dir}/plugin.json`);
    expect(manifest.$schema).toBe(AGENT_PLUGIN_SCHEMA);
    expect(manifest.name).toMatch(NAME);
    expect(manifest.name.length).toBeLessThanOrEqual(64);
    for (const key of ['version', 'description', 'homepage', 'repository', 'license'])
      expect(typeof manifest[key]).toBe('string');
    expect(
      Object.keys(manifest.author).every((k) => ['name', 'email', 'url'].includes(k)),
    ).toBe(true);
    expect(manifest.keywords.every((k: unknown) => typeof k === 'string')).toBe(true);
    for (const [ns, value] of Object.entries(manifest.extensions)) {
      expect(ns).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(
        true,
      );
    }
    // Skills: skills/<name>/SKILL.md, one level deep, nothing deeper named SKILL.md.
    const skills = pkgFiles(dir).filter((p) => p.endsWith('/SKILL.md'));
    expect(skills).toEqual([`${OUT}/${dir}/skills/tracetoon/SKILL.md`]);
    const mcpPath = `${OUT}/${dir}/mcp.json`;
    if (!files.has(mcpPath)) return;
    const mcp = parse(mcpPath);
    expect(Object.keys(mcp).sort()).toEqual(['$schema', 'mcpServers']);
    expect(mcp.$schema).toBe(AGENT_MCP_SCHEMA);
    // The mcp.json schema version matches the plugin.json one (§10).
    expect(mcp.$schema.split('/')[4]).toBe(manifest.$schema.split('/')[4]);
    for (const server of Object.values<any>(mcp.mcpServers)) {
      expect(
        Object.keys(server).every((k) =>
          ['type', 'command', 'args', 'env', 'cwd'].includes(k),
        ),
      ).toBe(true);
      expect(server.type).toBe('stdio');
      expect(server.command).toMatch(/^(?:\.\/)?[^\s/]+$/);
      expect(Object.keys(server.env ?? {})).not.toContain('PLUGIN_ROOT');
      expect(Object.keys(server.env ?? {})).not.toContain('PLUGIN_DATA');
    }
  });
});

describe('Agent Plugins (every package; Codex, Copilot CLI and Kiro read it)', () => {
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
  test.each([
    'claude',
    'claude-directory',
    'cursor',
    'codex',
    'codex-directory',
    'agent',
  ])('%s/plugin.json keeps to the closed field set', (dir) => {
    const manifest = parse(`${OUT}/${dir}/plugin.json`);
    expect(Object.keys(manifest).filter((k) => !FIELDS.includes(k))).toEqual([]);
    expect(manifest.$schema).toContain('1.0.0');
    expect(manifest.author.name).toBe('Cassandra Chin');
    expect(manifest.keywords.length).toBeGreaterThan(3);
  });
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

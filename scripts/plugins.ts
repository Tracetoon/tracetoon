/**
 * The thin plugin packages agent catalogs review, one folder per host under
 * plugins/. Each holds only text and a PNG icon: the skill (with the runtime
 * section rewritten to run `npx -y tracetoon@<version>`), that host's manifest,
 * hooks and MCP entry, a README and REVIEW.md. The runtime itself (binary,
 * WebAssembly, fonts) comes from the `tracetoon` npm package at exactly this
 * version, so a reviewed plugin never runs anything it doesn't name.
 *
 * Catalog rules behind each choice (read 2026-11-18) are in
 * docs/agents/submissions.md. The release workflow copies plugins/ to the
 * `plugins` branch once npm serves the version.
 *
 *   bun scripts/plugins.ts          write plugins/
 *   bun scripts/plugins.ts --check  exit 1 when plugins/ is out of date
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import pkg from '../package.json';
import { PR_COMMAND_GLOBS } from '../src/hook/prCommands.ts';
import {
  ACTIVATION,
  AUTHOR,
  BENEFITS,
  KEYWORDS,
  REPO_URL,
  RESULTS,
  SITE,
  codexInterface,
  json,
  listingDescription,
  root,
} from './agent-surfaces.ts';

export const OUT = 'plugins';
export const SKILL_SOURCE = 'plugin/skills/tracetoon';
const ISSUES = `${REPO_URL}/issues`;
const INSTALL_DOC = `${REPO_URL}/blob/main/docs/agents/install.md`;
/** The square app tile from the logo kit (scripts/brand.ts), as a PNG every catalog accepts. */
const ICON_SOURCE = 'docs/brand/png/tracetoon-icon-tile-dark-512.png';
const ICON = 'assets/tracetoon.png';

/** The npx arguments every package runs: exactly this version, from npm's cache when it has it. */
export const NPX_ARGS = ['-y', '--prefer-offline', `tracetoon@${pkg.version}`];
const npx = (...args: string[]) => ['npx', ...NPX_ARGS, ...args].join(' ');
const pluginHook = (agent: string, event: string) =>
  npx('hook', 'plugin', '--agent', agent, '--event', event);
const mcpEntry = () => ({ command: 'npx', args: [...NPX_ARGS, 'mcp'] });

export type Files = Map<string, string | Buffer>;

/**
 * Every host the plugin's parts can reach (REVIEW.md says when): npm for the
 * runtime, GitHub when the user publishes, and an image service only after the
 * user approves that comic route.
 */
export const NETWORK_HOSTS = [
  'registry.npmjs.org',
  'github.com',
  'api.github.com',
  'uploads.github.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];

// ---------------------------------------------------------------------------
// The skill, with its runtime and update sections rewritten for npm.
// ---------------------------------------------------------------------------

const RUNTIME = `Tracetoon's runtime comes from npm, at the version this plugin was reviewed
with. Below, \`tracetoon\` means \`npx -y tracetoon@${pkg.version}\` (exactly that
version). Run it from inside the user's repository. Every command accepts
\`--json\`. The first run downloads the runtime; later runs use npm's cache.

If \`npx\` is not found (Tracetoon needs Node.js 18 or later), or the command
exits with code **3**, the runtime can't start. Tell the user: they can install
Node.js, or install the standalone binary (the install guide is linked from
this plugin's README) (then \`tracetoon\` on their PATH replaces the npx command). Don't install
anything yourself unless they ask. If they decline, follow
[references/manual-mode.md](references/manual-mode.md).`;

const UPDATE = `## Updating Tracetoon

This plugin pins the runtime version, and the agent's plugin manager updates
both together. Only when the user asks to update Tracetoon: tell them to update
the plugin (Claude Code: \`/plugin\`, or \`/plugin marketplace update\`; Cursor:
the Marketplace; Codex: \`codex plugin marketplace upgrade\`; Copilot CLI:
\`copilot plugin update tracetoon\`), then reload the agent. Never update on your
own, and never while a PR is being made. \`tracetoon update --check --json\`
reports whether a newer release exists; \`tracetoon update\` doesn't replace a
plugin's runtime and says so.`;

/**
 * Packages for catalogs that accept no hooks (the Anthropic directory for
 * unverified publishers, the OpenAI directory) say so, and point at the
 * standalone install, which adds the hook with a fast local binary.
 */
const SKILL_ONLY = `This copy of the skill came without hooks (the catalog it was listed in
doesn't allow them). So a plain \`gh pr create\` isn't routed here, and
\`prepare\` matches sessions from the agent's own logs. In step 1, if
\`tracetoon doctor --json\` reports the \`pr-hook\` check failing, tell the user
once that the standalone install (linked from this plugin's README) adds the
hook, then carry on.
Install it only if they ask.`;

function swap(text: string, name: string, body: string): string {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
  if (!re.test(text)) throw new Error(`SKILL.md has no ${name} markers`);
  return text.replace(re, body);
}

/** The skill's files as the packages ship them (path relative to the skill folder). */
export function thinSkill(hooks = true): Map<string, string> {
  const out = new Map<string, string>();
  const src = join(root, SKILL_SOURCE);
  let skill = readFileSync(join(src, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  skill = swap(skill, 'runtime', hooks ? RUNTIME : `${RUNTIME}\n\n${SKILL_ONLY}`);
  skill = swap(skill, 'update', UPDATE);
  skill = skill
    .replace(
      /^compatibility: Requires git and/m,
      'compatibility: Requires Node.js 18 or later (npx), git and',
    )
    .replace(
      "(the launcher's full path if `tracetoon` isn't on their PATH)",
      '(the pinned npx command)',
    );
  // The Anthropic directory holds a skill that names an environment variable
  // or a key beside a remote URL (MCP_FORWARDS_CREDENTIAL_ENV), so the packaged
  // skill says these in words and leaves URLs to the README.
  for (const [from, to] of [
    [
      "prefix the `gh` command\nwith `TRACETOON=0` (PowerShell: `$env:TRACETOON='0'; gh pr create ...`). Never use",
      'use the\none-command bypass that `tracetoon status` prints. Never use',
    ],
    ['(`gh auth switch`)', '(in the GitHub CLI)'],
    ['agent after setting a key)', 'agent after adding the setting)'],
  ]) {
    if (!skill.includes(from!)) throw new Error(`SKILL.md no longer has: ${from}`);
    skill = skill.replace(from!, to!);
  }
  out.set('SKILL.md', skill);
  for (const name of readdirSync(join(src, 'references')).sort()) {
    if (!name.endsWith('.md')) continue;
    let text = readFileSync(join(src, 'references', name), 'utf8').replace(/\r\n/g, '\n');
    if (name === 'manual-mode.md')
      text = text.replace(
        'Use this only when the launcher exits with code 3 and the user declined the\ndownload.',
        "Use this only when Tracetoon's runtime can't start (no Node.js for npx, or\nexit code 3) and the user declined the installer.",
      );
    out.set(`references/${name}`, text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hooks, one format per host.
// ---------------------------------------------------------------------------

/**
 * Claude Code: the PR check runs only for commands a PR_COMMAND_GLOBS rule
 * matches (one handler per rule: `if` takes a single rule), and for GitHub
 * connector tools that create a PR. Observation runs asynchronously so no tool
 * call waits for npx; SessionStart also warms npm's cache.
 */
export function claudeHooks() {
  const pre = (rule: string) => ({
    type: 'command',
    if: rule,
    command: pluginHook('claude', 'PreToolUse'),
    timeout: 60,
  });
  return {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: PR_COMMAND_GLOBS.map((g) => pre(`Bash(${g})`)) },
        {
          matcher: 'PowerShell',
          hooks: PR_COMMAND_GLOBS.map((g) => pre(`PowerShell(${g})`)),
        },
        {
          matcher: 'mcp__.*(create_pull_request|create_pr)',
          hooks: [
            { type: 'command', command: pluginHook('claude', 'PreToolUse'), timeout: 60 },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit',
          hooks: [
            {
              type: 'command',
              command: pluginHook('claude', 'PostToolUse'),
              async: true,
              timeout: 60,
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: pluginHook('claude', 'SessionStart'),
              async: true,
              timeout: 300,
            },
          ],
        },
      ],
    },
  };
}

/** The same rules as one regular expression, for hosts whose matcher reads the command. */
export const PR_COMMAND_PATTERN = PR_COMMAND_GLOBS.map((g) =>
  g.replace(/^\*|\*$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|');

/**
 * Cursor (cursor.com/docs/hooks): beforeShellExecution can deny; sessionStart
 * records the session once. Cursor has no asynchronous hooks, so tool calls
 * aren't observed (prepare still matches the session from Cursor's logs).
 */
export function cursorHooks() {
  return {
    version: 1,
    hooks: {
      beforeShellExecution: [
        {
          command: pluginHook('cursor', 'PreToolUse'),
          matcher: PR_COMMAND_PATTERN,
          timeout: 60,
        },
      ],
      sessionStart: [{ command: pluginHook('cursor', 'SessionStart'), timeout: 300 }],
    },
  };
}

/** Codex (Claude-style hooks.json): the PR check on Bash, and the session start. */
export function codexHooks() {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: pluginHook('codex', 'PreToolUse'), timeout: 60 },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: pluginHook('codex', 'SessionStart'),
              timeout: 300,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Copilot CLI (com.github.copilot/hooks): `exec` + `args` start npx directly.
 * Copilot fails closed when a preToolUse hook errors; the plugin hook always
 * exits 0.
 */
export function copilotHooks() {
  const entry = (event: string) => ({
    type: 'command',
    exec: 'npx',
    args: [...NPX_ARGS, 'hook', 'plugin', '--agent', 'copilot', '--event', event],
    timeoutSec: 60,
  });
  return {
    version: 1,
    hooks: {
      preToolUse: [
        { matcher: 'bash|powershell|.*pull_request.*', hooks: [entry('PreToolUse')] },
      ],
      sessionStart: [{ hooks: [entry('SessionStart')] }],
    },
  };
}

// ---------------------------------------------------------------------------
// README and REVIEW, shared by every package.
// ---------------------------------------------------------------------------

interface Host {
  dir: string;
  label: string;
  install: string[];
  hooks: string;
  /** False for skills-only packages: no hooks and no local MCP server. */
  runs?: false;
}

const HOSTS: Host[] = [
  {
    dir: 'claude',
    label: 'Claude Code',
    install: [
      '/plugin marketplace add Tracetoon/tracetoon',
      '/plugin install tracetoon@tracetoon',
    ],
    hooks:
      'Before a shell command that could create a PR (or a GitHub connector call that would), it asks the runtime whether to route it through the skill. After file edits and shell commands, and at session start, it records which repositories the session works in, without blocking.',
  },
  {
    dir: 'claude-directory',
    label: 'the Claude plugin directory (skills only)',
    install: [
      'Install Tracetoon from the plugin directory: /plugin in Claude Code, or Customize → Plugins in Claude Desktop.',
    ],
    hooks: `None: the directory accepts hooks and local MCP servers only from verified publishers, so the skill starts when you ask for a PR. For the hook that routes a plain \`gh pr create\` here, add the standalone install (${INSTALL_DOC}), or install from the Tracetoon marketplace instead: \`/plugin marketplace add Tracetoon/tracetoon\`.`,
    runs: false,
  },
  {
    dir: 'cursor',
    label: 'Cursor',
    install: ['Install Tracetoon from the Cursor Marketplace.'],
    hooks:
      'Before a shell command that could create a PR it asks the runtime whether to route it through the skill; at session start it records the session.',
  },
  {
    dir: 'codex',
    label: 'Codex',
    install: [
      'codex plugin marketplace add Tracetoon/tracetoon',
      'Then install Tracetoon from /plugins and trust its hooks in /hooks.',
    ],
    hooks:
      'Before a shell command it asks the runtime whether the command creates a PR and should go through the skill; at session start it records the session.',
  },
  {
    dir: 'codex-directory',
    label: 'the OpenAI plugin directory (skills only)',
    install: ['Install Tracetoon from the ChatGPT or Codex plugin directory.'],
    hooks:
      'None: the directory accepts no lifecycle hooks or local MCP servers, so the skill starts when you ask for a PR.',
    runs: false,
  },
  {
    dir: 'agent',
    label: 'GitHub Copilot CLI and Kiro',
    install: [
      'copilot plugin install Tracetoon/tracetoon:plugins/agent',
      'Kiro: Powers → Add power from GitHub → Tracetoon/tracetoon, folder plugins/agent.',
    ],
    hooks:
      'Copilot CLI: before a shell command it asks the runtime whether the command creates a PR; at session start it records the session. Kiro runs the skill and MCP server only.',
  },
];

function readme(h: Host): string {
  return `# Tracetoon for ${h.label}

${listingDescription()}

## Why use it

${BENEFITS.map(([title, body]) => `- **${title}.** ${body}`).join('\n')}

## Install

${h.install.map((l) => (/^[a-z/]/.test(l) ? `\`\`\`\n${l}\n\`\`\`` : l)).join('\n\n')}

## What it needs

- Node.js 18 or later: the plugin runs Tracetoon with \`npx -y tracetoon@${pkg.version}\`.
  The first run downloads it from npm; later runs use npm's cache.
- \`git\`, and the GitHub CLI (\`gh\`) signed in, to publish the PR.
- macOS, Linux or Windows.

## What runs

- **Skill:** \`skills/tracetoon\`. Your agent follows it when you ask it to open or describe a PR.
- **Hooks:** ${h.hooks}
- **Runtime:** the \`tracetoon\` npm package at exactly ${pkg.version}, its source at
  ${REPO_URL}/tree/v${pkg.version}, published from GitHub Actions with npm provenance.

What it reads, writes and sends, and how to check it: [REVIEW.md](REVIEW.md).

## Results

${RESULTS.sentence} (${RESULTS.url})

## Support

Questions and bugs: ${ISSUES}. Website: ${SITE}. License: Apache-2.0.
`;
}

function review(h: Host): string {
  const parts =
    h.runs === false
      ? "the skill's commands run that exact\n  npm version."
      : "the hooks, the MCP server and the skill's\n  commands all run that exact npm version.";
  return `# Reviewing Tracetoon

What this plugin runs, reads, writes and sends, for catalog reviewers and
security-minded users.

## What runs

- Only \`npx -y tracetoon@${pkg.version}\`: ${parts} The package (\`tracetoon\`, plus one
  platform package \`@tracetoon/cli-<os>-<arch>\` holding the prebuilt binary)
  is published from ${REPO_URL} by GitHub Actions trusted publishing, with npm
  provenance tying each file to the tagged source (\`v${pkg.version}\`). It has
  no install scripts and no dependencies.
- Nothing in the plugin folder executes; it is Markdown, JSON and one PNG.

## What it reads

- Your coding agents' session logs, in the folders each agent already writes
  (Claude Code: \`~/.claude/projects\`; the full list is in
  ${REPO_URL}/blob/main/docs/agents/support.md).
- The current repository: its git history and diff, PR template and
  contribution guide.
- Hook input from your agent: the tool name, the command and its folder.

Logs and diffs are treated as data, never as instructions.

## What it writes

- \`<repo>/.git/tracetoon/runs/\`: each PR's digest, evidence brief and draft.
- \`~/.config/tracetoon/\` (Windows: \`%APPDATA%\\tracetoon\`): settings, which
  repositories a session touched, and hook diagnostics.
- Nothing outside these, except the PR you ask it to publish.

## What it sends, and when

- **GitHub**, through your signed-in \`gh\`: only when you ask to publish a PR
  (\`tracetoon publish\`). It pushes the branch and creates or updates the PR.
  Private paths and secrets are redacted, and a leak scan runs first.
- **An image service** (Codex, Antigravity, OpenAI or Gemini), only for a comic
  and only after you approve that route once. The comic prompt is the only thing sent.
- **npm**, to download the runtime on first use.
- No telemetry.

## Consent

- Publishing happens only on request. \`tracetoon publish --dry-run --json\`
  shows exactly what would happen.
- Image routes need explicit approval (\`tracetoon images --approve <route>\`).
- \`TRACETOON=0\` in front of a command, or \`tracetoon off\`, turns it off.

## Check it yourself

1. In a git repository with a branch your agent worked on, ask:
   _"Open a PR for this branch with Tracetoon."_ The agent runs
   \`tracetoon prepare\`, drafts the description, and publishes when you agree.
${
  h.runs === false
    ? "2. Safe failure: in a folder that isn't a git repository, ask for a PR. `tracetoon prepare`\n   stops with an error naming the fix, and nothing is sent."
    : '2. Safe failure: run `gh pr create` directly. The hook stops it and tells the\n   agent to use the skill; `TRACETOON=0 gh pr create` goes through untouched.'
}
3. \`npx -y tracetoon@${pkg.version} doctor --json\` lists every check and its fix.

## Licenses

Tracetoon is Apache-2.0. The runtime includes Comic Neue (SIL OFL 1.1), resvg
(Apache-2.0 / MIT) and Relate (Apache-2.0).
`;
}

// ---------------------------------------------------------------------------
// Packages.
// ---------------------------------------------------------------------------

function common(files: Files, dir: string, host: Host) {
  for (const [path, text] of thinSkill(host.runs !== false))
    files.set(`${dir}/skills/tracetoon/${path}`, text);
  files.set(`${dir}/${ICON}`, readFileSync(join(root, ICON_SOURCE)));
  files.set(`${dir}/README.md`, readme(host));
  files.set(`${dir}/REVIEW.md`, review(host));
  files.set(`${dir}/LICENSE`, readFileSync(join(root, 'LICENSE'), 'utf8'));
}

const host = (dir: string) => HOSTS.find((h) => h.dir === dir)!;

function claudePackage(files: Files) {
  const dir = `${OUT}/claude`;
  common(files, dir, host('claude'));
  files.set(
    `${dir}/.claude-plugin/plugin.json`,
    json({
      name: 'tracetoon',
      version: pkg.version,
      description: listingDescription(),
      author: AUTHOR,
      homepage: SITE,
      repository: REPO_URL,
      license: 'Apache-2.0',
      keywords: KEYWORDS,
      icon: `./${ICON}`,
      documentationUrl: `${REPO_URL}/blob/main/docs/agents/install.md`,
      supportUrl: ISSUES,
      network: { hosts: NETWORK_HOSTS },
    }),
  );
  files.set(`${dir}/hooks/hooks.json`, json(claudeHooks()));
  files.set(`${dir}/.mcp.json`, json({ mcpServers: { tracetoon: mcpEntry() } }));
}

/**
 * The Anthropic plugin directory, for publishers it hasn't verified: skills
 * only. Its validator refuses hooks of any type, local (stdio) MCP servers and
 * manifest fields Claude Code doesn't read. The full package (claude/) stays
 * on the Tracetoon marketplace.
 */
function claudeDirectoryPackage(files: Files) {
  const dir = `${OUT}/claude-directory`;
  common(files, dir, host('claude-directory'));
  files.set(
    `${dir}/.claude-plugin/plugin.json`,
    json({
      name: 'tracetoon',
      version: pkg.version,
      description: listingDescription(),
      author: AUTHOR,
      homepage: SITE,
      repository: REPO_URL,
      license: 'Apache-2.0',
      keywords: KEYWORDS,
      icon: `./${ICON}`,
    }),
  );
}

function cursorPackage(files: Files) {
  const dir = `${OUT}/cursor`;
  common(files, dir, host('cursor'));
  files.set(
    `${dir}/.cursor-plugin/plugin.json`,
    json({
      name: 'tracetoon',
      displayName: 'Tracetoon',
      version: pkg.version,
      description: listingDescription(),
      author: { name: 'Tracetoon' },
      homepage: SITE,
      repository: REPO_URL,
      license: 'Apache-2.0',
      keywords: KEYWORDS,
      logo: ICON,
    }),
  );
  files.set(`${dir}/hooks/hooks.json`, json(cursorHooks()));
  files.set(`${dir}/mcp.json`, json({ mcpServers: { tracetoon: mcpEntry() } }));
}

/** Agent Plugins 1.0.0 (agentplugins/agent-plugins-spec): a closed set of fields. */
function agentManifest(extensions: Record<string, unknown>) {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'tracetoon',
    version: pkg.version,
    description: listingDescription(),
    author: AUTHOR,
    homepage: SITE,
    repository: REPO_URL,
    license: 'Apache-2.0',
    keywords: ACTIVATION,
    extensions,
  };
}

function codexInterfaceFor(): Record<string, unknown> {
  return { ...codexInterface(), composerIcon: `./${ICON}`, logo: `./${ICON}` };
}

function codexPackage(files: Files) {
  const dir = `${OUT}/codex`;
  common(files, dir, host('codex'));
  files.set(
    `${dir}/plugin.json`,
    json(agentManifest({ 'com.openai': { interface: codexInterfaceFor() } })),
  );
  files.set(
    `${dir}/.codex-plugin/plugin.json`,
    json({
      name: 'tracetoon',
      version: pkg.version,
      description: listingDescription(),
      author: AUTHOR,
      homepage: SITE,
      repository: REPO_URL,
      license: 'Apache-2.0',
      keywords: KEYWORDS,
      skills: './skills/',
      interface: codexInterfaceFor(),
    }),
  );
  files.set(`${dir}/hooks/hooks.json`, json(codexHooks()));
  files.set(`${dir}/mcp.json`, json({ mcpServers: { tracetoon: mcpEntry() } }));
}

/** The OpenAI public directory ZIP: skills only (no hooks, no local MCP). */
function codexDirectoryPackage(files: Files) {
  const dir = `${OUT}/codex-directory`;
  common(files, dir, host('codex-directory'));
  files.set(
    `${dir}/plugin.json`,
    json(agentManifest({ 'com.openai': { interface: codexInterfaceFor() } })),
  );
  files.set(
    `${dir}/.codex-plugin/plugin.json`,
    json({
      name: 'tracetoon',
      version: pkg.version,
      description: listingDescription(),
      author: AUTHOR,
      homepage: SITE,
      repository: REPO_URL,
      license: 'Apache-2.0',
      keywords: KEYWORDS,
      skills: './skills/',
      interface: codexInterfaceFor(),
    }),
  );
}

/** Copilot CLI (awesome-copilot) and Kiro Powers read the same Agent Plugins folder. */
function agentPackage(files: Files) {
  const dir = `${OUT}/agent`;
  common(files, dir, host('agent'));
  files.set(`${dir}/plugin.json`, json(agentManifest({})));
  files.set(`${dir}/mcp.json`, json({ mcpServers: { tracetoon: mcpEntry() } }));
  files.set(`${dir}/com.github.copilot/hooks/hooks.json`, json(copilotHooks()));
}

function indexReadme(): string {
  return `# Tracetoon plugin packages

Generated by scripts/plugins.ts for version ${pkg.version}. Each folder is one
catalog's package; all run the \`tracetoon\` npm package at exactly this version.

${HOSTS.map((h) => `- [\`${h.dir}/\`](${h.dir}/): ${h.label}`).join('\n')}

How each is submitted: ${REPO_URL}/blob/main/docs/agents/submissions.md
`;
}

/** Every file under plugins/, keyed by repository path. */
export function pluginFiles(): Files {
  const files: Files = new Map();
  files.set(`${OUT}/README.md`, indexReadme());
  claudePackage(files);
  claudeDirectoryPackage(files);
  cursorPackage(files);
  codexPackage(files);
  codexDirectoryPackage(files);
  agentPackage(files);
  return files;
}

/** Replace plugins/ with the generator's output; returns the file count. */
export function writePlugins(): number {
  rmSync(join(root, OUT), { recursive: true, force: true });
  const files = pluginFiles();
  for (const [path, data] of files) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  return files.size;
}

function onDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split('\\').join('/'));
    }
  };
  walk(join(root, OUT));
  return out.sort();
}

const same = (a: string | Buffer, b: Buffer) =>
  typeof a === 'string'
    ? b.toString('utf8').replace(/\r\n/g, '\n') === a
    : Buffer.compare(a, b) === 0;

/** Paths under plugins/ that differ from what the generator writes (or shouldn't be there). */
export function stalePlugins(): string[] {
  const want = pluginFiles();
  const bad = [...want]
    .filter(([path, data]) => {
      const file = join(root, path);
      return !existsSync(file) || !same(data, readFileSync(file));
    })
    .map(([path]) => path);
  for (const path of onDisk()) if (!want.has(path)) bad.push(path);
  return bad.sort();
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    const bad = stalePlugins();
    if (bad.length) {
      console.error(`Out of date (run bun scripts/plugins.ts):\n  ${bad.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`Plugin packages are current (${pkg.version}).`);
  } else console.log(`Wrote ${writePlugins()} files under ${OUT}/.`);
}

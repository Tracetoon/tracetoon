/**
 * How each Recommended agent is installed, pointed at the fake model and run
 * headless. Everything else (hooks, tracing, PR evidence) is the shared
 * harness in verify.ts. A recipe only writes inside the sandbox home it is
 * given.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexHookHash } from '../../src/integrations/codex/trust.ts';
import { isOurs } from '../../src/hook/config.ts';

export interface Sandbox {
  home: string;
  repo: string;
  /** Folder of helper scripts (the user hook, the gh shim). */
  bin: string;
  env: NodeJS.ProcessEnv;
  /** The fake model's base URL, without a trailing slash or /v1. */
  llm: string;
}

export interface Command {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface Recipe {
  /** The integration id in registry.ts. */
  integration: string;
  /**
   * fake-llm: the agent talks to the scripted model (free). free-plan: the
   * agent's own service can't be replaced (Cursor), so one short real session
   * runs on a free account whose token is in `secret`.
   */
  evidence: 'fake-llm' | 'free-plan';
  /** The environment variable holding the free-plan token. */
  secret?: string;
  /** false when the installer can't install a chosen version (it takes the newest). */
  pinned?: boolean;
  /** The trace adapter that must find the session (canary-check ids). */
  adapter: string;
  /** npm package for `npm install -g <pkg>@<version>`, or a custom installer. */
  install(version: string): Command[];
  /** Prints the installed version; its output must contain the version. */
  version: Command | ((version: string) => Command);
  /** Point the agent at the fake model (config files, environment). */
  configure(s: Sandbox): void;
  /**
   * An unrelated hook the user already had, which must still be there after
   * install and uninstall, and still run. Returns the config file it wrote.
   */
  seedUserHook(s: Sandbox): string;
  /** Called after Tracetoon's hook is installed: trust steps the agent needs. */
  afterHookInstall?(s: Sandbox): void;
  /** One headless run of the prompt in the sandbox repo. */
  run(s: Sandbox, prompt: string, version: string): Command;
}

const npm = (pkg: string) => (version: string) => [
  { cmd: 'npm', args: ['install', '-g', `${pkg}@${version || 'latest'}`] },
];

const writeJson = (file: string, data: unknown) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

/** The user hook: a script that records that it ran, then allows the call. */
export function userHookCommand(s: Sandbox): string {
  return `node "${join(s.bin, 'user-hook.cjs').replace(/\\/g, '/')}"`;
}

export const RECIPES: Record<string, Recipe> = {
  claude: {
    integration: 'claude',
    evidence: 'fake-llm',
    adapter: 'claude-code',
    install: npm('@anthropic-ai/claude-code'),
    version: { cmd: 'claude', args: ['--version'] },
    configure(s) {
      Object.assign(s.env, {
        CLAUDE_CONFIG_DIR: join(s.home, '.claude'),
        ANTHROPIC_BASE_URL: s.llm,
        ANTHROPIC_API_KEY: 'sk-ant-fake-compat',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
      });
    },
    seedUserHook(s) {
      const file = join(s.home, '.claude', 'settings.json');
      writeJson(file, {
        theme: 'dark',
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: userHookCommand(s) }],
            },
          ],
        },
      });
      return file;
    },
    run: (_s, prompt) => ({
      cmd: 'claude',
      args: [
        '-p',
        prompt,
        '--model',
        'claude-compat',
        '--dangerously-skip-permissions',
        '--max-turns',
        '8',
      ],
    }),
  },

  codex: {
    integration: 'codex',
    evidence: 'fake-llm',
    adapter: 'codex',
    install: npm('@openai/codex'),
    version: { cmd: 'codex', args: ['--version'] },
    configure(s) {
      const home = join(s.home, '.codex');
      Object.assign(s.env, { CODEX_HOME: home, COMPAT_API_KEY: 'sk-fake-compat' });
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(home, 'config.toml'),
        [
          // A model name Codex knows, so it offers its usual tools (apply_patch);
          // the requests still go only to the fake model.
          'model = "gpt-6-luna"',
          'model_provider = "compat"',
          'approval_policy = "never"',
          'sandbox_mode = "danger-full-access"',
          'check_for_update_on_startup = false',
          '',
          '[model_providers.compat]',
          'name = "compat"',
          `base_url = "${s.llm}/v1"`,
          'wire_api = "responses"',
          'env_key = "COMPAT_API_KEY"',
          '',
        ].join('\n'),
      );
    },
    seedUserHook(s) {
      const file = join(s.home, '.codex', 'hooks.json');
      writeJson(file, {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: userHookCommand(s) }],
            },
          ],
        },
      });
      return file;
    },
    afterHookInstall(s) {
      // Trust every hook the way /hooks would, using Tracetoon's copy of Codex's
      // hash. If Codex changes the hash, its hooks don't run and the check fails.
      const file = join(s.home, '.codex', 'hooks.json');
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const lines: string[] = [];
      for (const [event, groups] of Object.entries<any[]>(data.hooks ?? {}))
        groups.forEach((group, g) =>
          (group.hooks ?? []).forEach((handler: any, h: number) => {
            const hash = codexHookHash(event, group.matcher, handler);
            if (!hash) return;
            const label = event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
            lines.push(
              `[hooks.state.'${file}:${label}:${g}:${h}']`,
              `trusted_hash = "${hash}"`,
              `enabled = true`,
              `# ${isOurs(handler.command) ? 'tracetoon' : 'user'}`,
              '',
            );
          }),
        );
      const toml = join(s.home, '.codex', 'config.toml');
      writeFileSync(toml, readFileSync(toml, 'utf8') + '\n' + lines.join('\n'));
    },
    run: (_s, prompt) => ({
      cmd: 'codex',
      args: [
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        prompt,
      ],
    }),
  },

  opencode: {
    integration: 'opencode',
    evidence: 'fake-llm',
    adapter: 'opencode',
    install: npm('opencode-ai'),
    version: { cmd: 'opencode', args: ['--version'] },
    configure(s) {
      const config = join(s.home, '.config');
      Object.assign(s.env, {
        XDG_CONFIG_HOME: config,
        XDG_DATA_HOME: join(s.home, '.local', 'share'),
        XDG_STATE_HOME: join(s.home, '.local', 'state'),
        XDG_CACHE_HOME: join(s.home, '.cache'),
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_SHARE: '1',
      });
      writeJson(join(config, 'opencode', 'opencode.json'), {
        $schema: 'https://opencode.ai/config.json',
        autoupdate: false,
        model: 'compat/fake-model',
        small_model: 'compat/fake-model',
        provider: {
          compat: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Compat',
            options: { baseURL: `${s.llm}/v1`, apiKey: 'sk-fake-compat' },
            models: { 'fake-model': { name: 'Fake model', tool_call: true } },
          },
        },
        permission: { edit: 'allow', bash: 'allow', webfetch: 'deny' },
      });
    },
    seedUserHook(s) {
      // OpenCode hooks are plugin files; a user's own plugin must survive.
      const file = join(s.home, '.config', 'opencode', 'plugins', 'user-plugin.js');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const UserPlugin = async () => ({});\n');
      return file;
    },
    run: (_s, prompt) => ({
      cmd: 'opencode',
      args: ['run', '--model', 'compat/fake-model', prompt],
    }),
  },

  cursor: {
    integration: 'cursor',
    evidence: 'free-plan',
    secret: 'CURSOR_API_KEY',
    pinned: false,
    adapter: 'cursor',
    // Cursor publishes no versioned package: its installer fetches the newest
    // build, and the version is read back from the CLI afterwards.
    install: () => [
      { cmd: 'bash', args: ['-c', 'curl -fsS https://cursor.com/install | bash'] },
    ],
    version: { cmd: 'cursor-agent', args: ['--version'] },
    configure(s) {
      Object.assign(s.env, {
        CURSOR_HOME: join(s.home, '.cursor'),
        CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      });
    },
    seedUserHook(s) {
      const file = join(s.home, '.cursor', 'hooks.json');
      writeJson(file, {
        version: 1,
        hooks: { beforeShellExecution: [{ command: userHookCommand(s) }] },
      });
      return file;
    },
    run: (_s, prompt) => ({
      cmd: 'cursor-agent',
      args: ['-p', '--trust', '--force', '--output-format', 'text', prompt],
    }),
  },

  copilot: {
    integration: 'copilot',
    evidence: 'fake-llm',
    adapter: 'copilot-cli',
    install: npm('@github/copilot'),
    version: { cmd: 'copilot', args: ['--version'] },
    configure(s) {
      // Bring-your-own-model in offline mode: no GitHub sign-in, no Copilot quota.
      Object.assign(s.env, {
        COPILOT_HOME: join(s.home, '.copilot'),
        COPILOT_OFFLINE: 'true',
        COPILOT_PROVIDER_BASE_URL: `${s.llm}/v1`,
        COPILOT_PROVIDER_TYPE: 'openai',
        COPILOT_PROVIDER_API_KEY: 'sk-fake-compat',
        COPILOT_MODEL: 'fake-model',
        COPILOT_AUTO_UPDATE: 'false',
      });
    },
    seedUserHook(s) {
      // Copilot loads every file in ~/.copilot/hooks; the user's own must survive.
      const file = join(s.home, '.copilot', 'hooks', 'user.json');
      const [exec, ...args] = ['node', join(s.bin, 'user-hook.cjs').replace(/\\/g, '/')];
      writeJson(file, {
        version: 1,
        hooks: {
          preToolUse: [
            {
              matcher: 'bash|powershell',
              hooks: [{ type: 'command', exec, args, timeoutSec: 10 }],
            },
          ],
        },
      });
      return file;
    },
    run: (_s, prompt) => ({
      cmd: 'copilot',
      args: ['-p', prompt, '--allow-all-tools', '--no-auto-update'],
    }),
  },
};

const ACP_CLIENT = join(import.meta.dir, 'acp-client.ts');

/**
 * An editor workflow through an Agent Client Protocol adapter, the process
 * Zed starts for an external agent. It reuses the agent's own recipe for
 * configuration and hooks; the adapter (which bundles its own copy of the
 * agent) is fetched at the exact version with npx and driven by acp-client.ts.
 */
function acpRecipe(base: Recipe, pkg: string): Recipe {
  return {
    ...base,
    install: () => [],
    version: (v) => ({
      cmd: 'npm',
      args: ['view', `${pkg}@${v || 'latest'}`, 'version'],
    }),
    run: (s, prompt, v) => ({
      cmd: process.execPath,
      args: [
        ACP_CLIENT,
        '--cwd',
        s.repo,
        '--prompt',
        prompt,
        '--',
        'npx',
        '-y',
        `${pkg}@${v || 'latest'}`,
      ],
    }),
  };
}

RECIPES['zed-claude'] = acpRecipe(
  RECIPES.claude!,
  '@agentclientprotocol/claude-agent-acp',
);
RECIPES['zed-codex'] = acpRecipe(RECIPES.codex!, '@agentclientprotocol/codex-acp');

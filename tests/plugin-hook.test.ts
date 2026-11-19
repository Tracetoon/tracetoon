import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginAnswer } from '../src/hook/pluginHook.ts';
import { DENY_REASON } from '../src/hook/prHook.ts';
import {
  NPX_HOOK_NOTE,
  hookStatus,
  installHooks,
  type HookTarget,
} from '../src/hook/install.ts';
import {
  claudePluginEnabled,
  claudePluginHooks,
} from '../src/integrations/claude-code/plugin.ts';
import { skillTargets } from '../src/integrations/registry.ts';
import { launcher, pinnedUpdateHint, pluginHost } from '../src/util/launcher.ts';
import { installLayout, updatable } from '../src/update/layout.ts';
import { tempDir } from './helpers.ts';

let savedConfig: string | undefined;
beforeEach(() => {
  savedConfig = process.env.TRACETOON_CONFIG;
  process.env.TRACETOON_CONFIG = join(tempDir('tracetoon-cfg-'), 'config.json');
});
afterEach(() => {
  if (savedConfig === undefined) delete process.env.TRACETOON_CONFIG;
  else process.env.TRACETOON_CONFIG = savedConfig;
});
const env = { ...process.env, CI: '', TRACETOON: '' };
const claude = (command: string, cwd = tempDir()) => ({ tool_input: { command }, cwd });

/** A Claude config folder with the plugin installed (and optionally disabled). */
function claudeHome(plugin: string | null, enabled?: boolean, installPath?: string) {
  const dir = tempDir('tracetoon-claude-');
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  writeFileSync(
    join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: plugin
        ? { [plugin]: [{ scope: 'user', version: '1.0.0', installPath }] }
        : {},
    }),
  );
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify(
      enabled === undefined ? {} : { enabledPlugins: { [plugin!]: enabled } },
    ),
  );
  return dir;
}

describe('the plugin hook', () => {
  test('blocks PR creation before the tool runs', () => {
    const answer = pluginAnswer('claude', 'PreToolUse', claude('gh pr create -t x'), env);
    expect(answer).toBeDefined();
    const parsed = JSON.parse(answer!);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('tracetoon');
  });
  test('lets other commands through and says nothing', () => {
    expect(pluginAnswer('claude', 'PreToolUse', claude('ls -la'), env)).toBeUndefined();
    expect(
      pluginAnswer('claude', 'PostToolUse', claude('gh pr create'), env),
    ).toBeUndefined();
  });
  test('the PR check works even when observation has no session to record', () => {
    const answer = pluginAnswer('claude', 'PreToolUse', claude('gh pr create'), env);
    expect(answer).toContain('Tracetoon');
    expect(DENY_REASON.length).toBeGreaterThan(0);
  });
});

describe('Claude Code plugin detection', () => {
  test('an installed, enabled tracetoon plugin counts; others and disabled ones do not', () => {
    expect(claudePluginEnabled(claudeHome('tracetoon@tracetoon'))).toBe(true);
    expect(claudePluginEnabled(claudeHome('tracetoon@synced', true))).toBe(true);
    expect(claudePluginEnabled(claudeHome('tracetoon@tracetoon', false))).toBe(false);
    expect(claudePluginEnabled(claudeHome('other@market'))).toBe(false);
    expect(claudePluginEnabled(claudeHome(null))).toBe(false);
    expect(claudePluginEnabled(tempDir('tracetoon-empty-'))).toBe(false);
  });
  test('a skills-only plugin leaves the user-level hooks to setup', () => {
    const withHooks = tempDir('tracetoon-plugin-');
    mkdirSync(join(withHooks, 'hooks'), { recursive: true });
    writeFileSync(join(withHooks, 'hooks', 'hooks.json'), '{}');
    const skillsOnly = tempDir('tracetoon-plugin-');
    expect(claudePluginHooks(claudeHome('tracetoon@tracetoon', true, withHooks))).toBe(
      true,
    );
    expect(claudePluginHooks(claudeHome('tracetoon@synced', true, skillsOnly))).toBe(
      false,
    );
    expect(claudePluginEnabled(claudeHome('tracetoon@synced', true, skillsOnly))).toBe(
      true,
    );
    // Older entries without an install path came from the plugin with hooks.
    expect(claudePluginHooks(claudeHome('tracetoon@tracetoon'))).toBe(true);
    expect(claudePluginHooks(claudeHome('tracetoon@tracetoon', false, withHooks))).toBe(
      false,
    );
  });
  test('setup run from npx adds no user-level hooks', () => {
    const changes = installHooks(
      ['/tmp/_npx/x/tracetoon'],
      [
        {
          agent: 'claude-code',
          label: 'Claude Code',
          file: '/nonexistent/settings.json',
          present: true,
        },
      ],
      { TRACETOON_LAUNCHER: 'npx:1.2.3' },
    );
    expect(changes).toEqual([
      expect.objectContaining({ result: 'skipped', note: NPX_HOOK_NOTE }),
    ]);
  });
  test('setup leaves the skill folder alone when the plugin brings the skill', () => {
    const home = tempDir('tracetoon-home-');
    const withPlugin = claudeHome('tracetoon@tracetoon');
    const without = claudeHome(null);
    const dirs = (config: string) =>
      skillTargets(home, { CLAUDE_CONFIG_DIR: config }).map((t) => t.dir);
    expect(dirs(withPlugin)).not.toContain(join(withPlugin, 'skills', 'tracetoon'));
    expect(dirs(without)).toContain(join(without, 'skills', 'tracetoon'));
  });
});

describe('user-level hooks next to a plugin', () => {
  test('hook install removes Tracetoon entries the plugin already runs, keeping others', () => {
    const dir = tempDir('tracetoon-claude-');
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{}');
    const target: HookTarget = {
      agent: 'claude',
      label: 'Claude Code',
      file,
      present: true,
    };
    installHooks(['/opt/tracetoon'], [target]);
    const mine = JSON.parse(readFileSync(file, 'utf8'));
    mine.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'mine' }],
    });
    writeFileSync(file, JSON.stringify(mine));
    const [change] = installHooks(['/opt/tracetoon'], [{ ...target, plugin: true }]);
    expect(change!.result).toBe('removed');
    expect(change!.note).toContain('plugin');
    const after = readFileSync(file, 'utf8');
    expect(after).not.toContain('hook pre-pr');
    expect(after).toContain('"mine"');
    const [status] = hookStatus([{ ...target, plugin: true }]);
    expect(status!.installed).toBe(true);
    expect(status!.command).toStartWith('plugin:');
  });
});

describe('a runtime started by npm', () => {
  test('the launcher value names npx, npm or a script', () => {
    expect(launcher({ TRACETOON_LAUNCHER: 'npx:1.2.3' })).toEqual({
      kind: 'npx',
      version: '1.2.3',
    });
    expect(launcher({ TRACETOON_LAUNCHER: 'npm:1.2.3' })).toEqual({
      kind: 'npm',
      version: '1.2.3',
    });
    expect(launcher({ TRACETOON_LAUNCHER: '/x/bin/tracetoon' }).kind).toBe('script');
    expect(launcher({}).kind).toBe('none');
  });
  test('update leaves a pinned copy to the plugin that pins it', () => {
    const home = tempDir('tracetoon-home-');
    const layout = installLayout(
      { XDG_DATA_HOME: join(home, 'data') },
      home,
      'linux',
      'x64',
    );
    const viaClaude = updatable(layout, '/n/tracetoon', {
      TRACETOON_LAUNCHER: 'npx:1.2.3',
      CLAUDECODE: '1',
    });
    expect(!viaClaude.ok && viaClaude.reason).toContain('npx tracetoon@1.2.3');
    expect(!viaClaude.ok && viaClaude.reason).toContain('Claude Code');
    const viaCursor = updatable(layout, '/n/tracetoon', {
      TRACETOON_LAUNCHER: 'npx:1.2.3',
      CURSOR_PLUGIN_ROOT: '/p',
    });
    expect(!viaCursor.ok && viaCursor.reason).toContain('Cursor Marketplace');
    const global = updatable(layout, '/n/tracetoon', { TRACETOON_LAUNCHER: 'npm:1.2.3' });
    expect(!global.ok && global.reason).toContain('npm install -g tracetoon@latest');
  });
  test('the host is read from the variables its plugin sets', () => {
    expect(pluginHost({ CLAUDE_PLUGIN_ROOT: '/p' })).toBe('Claude Code');
    expect(pluginHost({ CURSOR_PLUGIN_ROOT: '/p' })).toBe('Cursor');
    expect(pluginHost({})).toBeUndefined();
    expect(pinnedUpdateHint({})).toContain('npx -y tracetoon@latest');
  });
});

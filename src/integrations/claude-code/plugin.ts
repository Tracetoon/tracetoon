/**
 * Whether Claude Code has the Tracetoon plugin installed and enabled: an entry
 * named tracetoon@<marketplace> in plugins/installed_plugins.json (directory
 * listings install as tracetoon@synced) that settings.json doesn't disable.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocal } from '../../util/localJson.ts';

interface Entry {
  installPath?: string;
}

function enabledEntries(dir: string): Entry[] {
  const installed = readLocal<{ plugins?: Record<string, Entry[]> }>(
    join(dir, 'plugins', 'installed_plugins.json'),
  );
  const enabled =
    readLocal<{ enabledPlugins?: Record<string, boolean> }>(join(dir, 'settings.json'))
      ?.enabledPlugins ?? {};
  return Object.entries(installed?.plugins ?? {})
    .filter(([name, entries]) => /^tracetoon@/.test(name) && entries?.length)
    .filter(([name]) => enabled[name] !== false)
    .flatMap(([, entries]) => entries);
}

export function claudePluginEnabled(dir: string): boolean {
  return enabledEntries(dir).length > 0;
}

/**
 * Whether that plugin brings its own hooks. The directory package is skills
 * only (the directory accepts no hooks from unverified publishers), so its
 * users still need the user-level hooks. An entry without an install path is
 * an older plugin, which always had hooks.
 */
export function claudePluginHooks(dir: string): boolean {
  return enabledEntries(dir).some(
    (e) => !e.installPath || existsSync(join(e.installPath, 'hooks', 'hooks.json')),
  );
}

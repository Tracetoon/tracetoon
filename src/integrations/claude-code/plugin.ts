/**
 * Whether Claude Code has the Tracetoon plugin installed and enabled: an entry
 * named tracetoon@<marketplace> in plugins/installed_plugins.json (directory
 * listings install as tracetoon@synced) that settings.json doesn't disable.
 */
import { join } from 'node:path';
import { readLocal } from '../../util/localJson.ts';

export function claudePluginEnabled(dir: string): boolean {
  const installed = readLocal<{ plugins?: Record<string, unknown[]> }>(
    join(dir, 'plugins', 'installed_plugins.json'),
  );
  const names = Object.entries(installed?.plugins ?? {})
    .filter(([name, entries]) => /^tracetoon@/.test(name) && entries?.length)
    .map(([name]) => name);
  if (!names.length) return false;
  const enabled =
    readLocal<{ enabledPlugins?: Record<string, boolean> }>(join(dir, 'settings.json'))
      ?.enabledPlugins ?? {};
  return names.some((name) => enabled[name] !== false);
}

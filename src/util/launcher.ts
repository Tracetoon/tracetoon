/**
 * How this runtime was started. The npm wrapper sets TRACETOON_LAUNCHER to
 * `npx:<version>` (run through npx, as the host plugins do) or `npm:<version>`
 * (an npm install); the skill's shell launcher sets it to its own path.
 */
export type Launcher =
  | { kind: 'npx' | 'npm'; version: string }
  | { kind: 'script'; path: string }
  | { kind: 'none' };

export function launcher(env: NodeJS.ProcessEnv = process.env): Launcher {
  const value = env.TRACETOON_LAUNCHER?.trim();
  if (!value) return { kind: 'none' };
  const npm = /^(npx|npm):(\S+)$/.exec(value);
  if (npm) return { kind: npm[1] as 'npx' | 'npm', version: npm[2]! };
  return { kind: 'script', path: value };
}

/** The agent whose plugin started this runtime, judged from the variables it sets. */
export function pluginHost(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CURSOR_PLUGIN_ROOT || env.CURSOR_TRACE_ID || env.CURSOR_AGENT) return 'Cursor';
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION)
    return 'Claude Code';
  return undefined;
}

/** How to move a pinned npx runtime forward: through the agent that pins it. */
export function pinnedUpdateHint(env: NodeJS.ProcessEnv = process.env): string {
  switch (pluginHost(env)) {
    case 'Claude Code':
      return 'Update the Tracetoon plugin in Claude Code (/plugin, or /plugin marketplace update); the plugin pins the runtime it runs.';
    case 'Cursor':
      return 'Update the Tracetoon plugin from the Cursor Marketplace; the plugin pins the runtime it runs.';
    default:
      return "Update the Tracetoon plugin with your agent's plugin manager (it pins the runtime it runs), or run the newest release directly with npx -y tracetoon@latest.";
  }
}

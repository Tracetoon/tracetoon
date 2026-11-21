/**
 * Goose (AAIF, formerly Block): the goose CLI and desktop app.
 *
 * Hooks come from plugins in ~/.agents/plugins/<name>/: a plugin.json manifest
 * and hooks/hooks.json in Claude Code's layout. Tracetoon owns the
 * ~/.agents/plugins/tracetoon folder outright. Payloads carry `event`,
 * `session_id`, `tool_name` (the shell tool is `shell`), `tool_input` and
 * `working_dir`; `{ "decision": "block", "reason" }` on stdout blocks the call
 * and the agent is told the reason. Skills are read from ~/.agents/skills.
 *
 * Goose runs each hook as `sh -c "<command>"` on every platform, so on Windows
 * the hook needs an `sh` on the PATH Goose Desktop inherits (shell.ts). Since
 * Goose 1.60, PreToolUse fires once per call when the model makes it, before
 * the user approves it, so lifecycle may note a tool call that is then refused.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyClaudeStyle } from '../../hook/claudeStyle.ts';
import { prePrIn } from '../../hook/config.ts';
import { onPath } from '../../util/onPath.ts';
import type { Env, HookCommands, HookPayload, Integration, Json } from '../types.ts';
import { readShFix, type ShDeps } from '../../hook/windowsSh.ts';
import { gooseHookFailures, gooseSh } from './shell.ts';
import { gooseAdapter, gooseDataDir } from './trace.ts';

const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined);
const PLUGIN = { name: 'tracetoon', version: '1.0.0' };

function parse(raw: unknown): HookPayload | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const p = raw as Json;
  if (typeof p.event !== 'string' || !('working_dir' in p || 'session_id' in p))
    return undefined;
  const toolInput: Json =
    p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const dir = str(p.working_dir);
  return {
    command: str(toolInput.command),
    cwd: str(toolInput.cwd) ?? dir,
    sessionId: str(p.session_id),
    toolName: str(p.tool_name),
    toolInput,
    workspaceRoots: dir ? [dir] : [],
    planMode: false,
    subagent: false,
  };
}

/** The pre-pr command in a hooks.json Tracetoon wrote, or that it is the manifest. */
function command(text: string): string | undefined {
  try {
    const data = JSON.parse(text);
    if (data?.name === PLUGIN.name && typeof data.description === 'string')
      return data.description.startsWith('Tracetoon')
        ? 'tracetoon plugin manifest'
        : undefined;
    return prePrIn(data?.hooks?.PreToolUse);
  } catch {
    return undefined;
  }
}

const render = (commands: HookCommands) =>
  JSON.stringify(applyClaudeStyle({}, commands, '^shell$'), null, 2) + '\n';

export const FIX_SH = 'tracetoon setup --agent goose --fix-sh';

/** Why Goose can't run the hook, or undefined when it can (see shell.ts). */
export function shProblem(deps: ShDeps = {}): string | undefined {
  const sh = gooseSh(deps);
  if (sh.found) return undefined;
  const failures = gooseHookFailures(deps.env);
  const seen = failures.last
    ? ` Goose logged ${failures.count} failed hook run${failures.count === 1 ? '' : 's'} (last ${failures.last.at}).`
    : '';
  const fix = sh.gitUsrBin
    ? `run \`${FIX_SH}\` to add ${sh.gitUsrBin} to your user PATH, then restart Goose`
    : `install Git for Windows, or run \`${FIX_SH}\` to add Tracetoon's own sh, then restart Goose`;
  return `Goose runs plugin hooks with \`sh -c\`, and Goose Desktop's PATH has no sh, so the PR hook never runs.${seen} Fix: ${fix}.`;
}

/** Goose still failed to start the hook after `--fix-sh`: usually it wasn't restarted. */
function staleProblem(deps: ShDeps = {}): string | undefined {
  const fixed = readShFix(deps.env);
  if (!fixed) return undefined;
  const last = gooseHookFailures(deps.env).last;
  if (!last || last.at < fixed.at) return undefined;
  return `Goose couldn't start the hook at ${last.at} (${last.error}), after sh was added to PATH at ${fixed.at}. Restart Goose (quit it from the tray) so it picks up the new PATH.`;
}

const problem = () =>
  process.platform === 'win32' ? (shProblem() ?? staleProblem()) : undefined;

const present = (h: string, env: Env) =>
  existsSync(gooseDataDir(env, h)) || !!onPath('goose', env);

export const integration: Integration = {
  id: 'goose',
  label: 'Goose',
  status: 'supported',
  supportTier: 'community',
  variants: 'CLI and desktop app',
  // Set by Goose's developer shell on every call; not part of the toolchain.
  hostEnv: /^(AGENT_SESSION_ID|GOOSE_TERMINAL)$/,
  limits: [
    "Goose runs hooks with `sh -c`, on Windows too. The desktop app doesn't see Git Bash's PATH, so unless Git for Windows' `usr\\bin` is on your user PATH the PR hook never runs: `tracetoon setup --agent goose --fix-sh` adds it (or, without Git, Tracetoon's own `sh`), and `tracetoon doctor` says when Goose couldn't start the hook.",
  ],
  traces: [gooseAdapter],
  hook: {
    file: (h) => join(h, '.agents', 'plugins', 'tracetoon', 'hooks', 'hooks.json'),
    present,
    apply: (data) => data,
    installedCommand: () => undefined,
    text: {
      render,
      command,
      siblings: {
        '../plugin.json': () =>
          JSON.stringify(
            {
              ...PLUGIN,
              description:
                'Tracetoon: routes PR creation through Tracetoon. Written by `tracetoon hook install`.',
            },
            null,
            2,
          ) + '\n',
      },
    },
    parse,
    deny: (reason) => JSON.stringify({ decision: 'block', reason }),
    // Goose starts every hook with `sh -c`, Windows included.
    installNote: problem,
    problem,
  },
  skill: (h, env) => ({
    present: present(h, env),
    dir: join(h, '.agents', 'skills', 'tracetoon'),
  }),
};

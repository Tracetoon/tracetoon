/**
 * `tracetoon setup`: put the skill that ships with this runtime into every
 * agent's skill folder and register the PR hook, the way the installers do,
 * without downloading anything. Running it again changes nothing.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { skillDir } from '../contribution/skillSettings.ts';
import { hookTargets, installHooks, type HookChange } from '../hook/install.ts';
import { INTEGRATIONS, integration, skillTargets } from '../integrations/registry.ts';
import { findSh, fixSh, type ShFix } from '../hook/windowsSh.ts';
import { selfProgram } from '../util/userCommand.ts';
import { skillInstalls } from './doctor.ts';
import { codedError, emit, UserError, type OutOpts } from './output.ts';

export interface SetupOpts extends OutOpts {
  agent?: string[];
  noHook?: boolean;
  /** Windows: put an `sh` on the user PATH so Goose can run its hooks. */
  fixSh?: boolean;
}

export interface SkillInstall {
  agents: string[];
  dir: string;
  action: 'installed' | 'updated' | 'unchanged';
}

/** Binaries the launcher downloads next to itself; never part of the skill. */
const CACHED_BINARY = /^bin\/tracetoon-(?:windows|linux|darwin)-/;

/** The skill folder this runtime shipped with: next to it, or an installed copy of the same build. */
export function skillSource(): string | undefined {
  const here = skillDir();
  if (here && existsSync(join(here, 'SKILL.md'))) return here;
  return skillInstalls().find((i) => i.matchesRuntime)?.dir;
}

/** Each file under `dir` (forward-slash relative path) with its SHA-256. */
function tree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const walk = (at: string) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, e.name);
      const rel = relative(dir, path).replace(/\\/g, '/');
      if (CACHED_BINARY.test(rel)) continue;
      if (e.isDirectory()) walk(path);
      else if (e.isFile())
        out.set(rel, createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

function sameTree(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Copy `source` to `dir`, replacing what is there only once the new copy is complete. */
function place(source: string, dir: string): void {
  const id = process.pid;
  const next = `${dir}.new-${id}`;
  const aside = `${dir}.old-${id}`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(source, next, {
    recursive: true,
    filter: (src) => !CACHED_BINARY.test(relative(source, src).replace(/\\/g, '/')),
  });
  if (existsSync(dir)) renameSync(dir, aside);
  try {
    renameSync(next, dir);
  } catch (e) {
    if (existsSync(aside)) renameSync(aside, dir);
    rmSync(next, { recursive: true, force: true });
    throw e;
  }
  rmSync(aside, { recursive: true, force: true });
}

/** Where the skill goes: every present agent, or just the ones named. */
function targets(agents: string[]): { labels: string[]; dir: string }[] {
  if (!agents.length) return skillTargets();
  const out: { labels: string[]; dir: string }[] = [];
  for (const id of agents) {
    const host = integration(id);
    if (!host)
      throw new UserError(
        `Unknown agent "${id}". Known: ${INTEGRATIONS.map((i) => i.id).join(', ')}.`,
        2,
        { code: 'USAGE', fix: 'tracetoon integrations --json' },
      );
    const t = host.skill?.(homedir(), process.env);
    if (!t) continue; // a host without a skill folder of its own
    const seen = out.find((o) => o.dir === t.dir);
    if (seen) seen.labels.push(host.label);
    else out.push({ labels: [host.label], dir: t.dir });
  }
  return out;
}

/** `--fix-sh`: give Goose an `sh` to run its hooks with (see integrations/goose/shell.ts). */
function fixGooseSh(): ShFix {
  if (process.platform !== 'win32')
    throw codedError(
      'USAGE',
      '--fix-sh is only for Windows; Goose finds sh on every other system.',
      'tracetoon setup --agent goose',
    );
  const exe = selfProgram();
  // The shim is a link to the standalone binary; from source or npx there's nothing stable to link.
  const linkable = exe.length === 1 ? exe[0]! : undefined;
  const state = findSh();
  if (!state.found && !state.gitUsrBin && !linkable)
    throw codedError(
      'GOOSE_SH_UNAVAILABLE',
      "Git for Windows isn't installed, and this Tracetoon isn't the standalone runtime, so there is no sh to give Goose.",
      'Install Git for Windows (https://git-scm.com/download/win), or the standalone runtime (docs/agents/install.md), then rerun with --fix-sh.',
    );
  return fixSh(linkable);
}

export function setupCmd(opts: SetupOpts): void {
  const source = skillSource();
  if (!source)
    throw codedError(
      'SKILL_SOURCE_NOT_FOUND',
      'Cannot find the skill shipped with this Tracetoon runtime.',
      'Follow https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/install.md',
    );
  const want = tree(source);
  const installed: SkillInstall[] = targets(opts.agent ?? []).map((t) => {
    if (resolve(t.dir) === resolve(source))
      return { agents: t.labels, dir: t.dir, action: 'unchanged' };
    const have = tree(t.dir);
    if (have.size && sameTree(want, have))
      return { agents: t.labels, dir: t.dir, action: 'unchanged' };
    const action = existsSync(t.dir) ? 'updated' : 'installed';
    place(source, t.dir);
    return { agents: t.labels, dir: t.dir, action };
  });
  let sh: ShFix | undefined;
  if (opts.fixSh) sh = fixGooseSh();
  let hooks: HookChange[] = [];
  if (!opts.noHook) {
    const ids = opts.agent ?? [];
    hooks = installHooks(
      selfProgram(),
      hookTargets().filter((h) => !ids.length || ids.includes(h.agent)),
    );
  }
  const restartRequired =
    installed.some((i) => i.action !== 'unchanged') ||
    hooks.some((h) => h.result === 'installed') ||
    sh?.result === 'added';
  emit(opts, { installed, hooks, ...(sh ? { gooseSh: sh } : {}), restartRequired }, () =>
    [
      ...(sh
        ? [
            sh.result === 'added'
              ? `Goose sh: added ${sh.dir} to your user PATH (${sh.kind === 'git' ? "Git for Windows' sh" : "Tracetoon's sh shim"}). Quit Goose from the tray and start it again.`
              : `Goose sh: already available (${sh.dir})`,
          ]
        : []),
      installed.length ? 'Skill:' : 'Skill: no agents found (name one with --agent <id>)',
      ...installed.map((i) => `  ${i.agents.join(', ')}: ${i.action} (${i.dir})`),
      ...(opts.noHook
        ? ['PR hook: left alone']
        : [
            'PR hook:',
            ...hooks
              .filter((h) => h.note !== 'not installed')
              .map((h) => `  ${h.label}: ${h.result}${h.note ? ` (${h.note})` : ''}`),
          ]),
      restartRequired
        ? 'Restart your agent so it loads the skill and hooks.'
        : 'Nothing changed.',
    ].join('\n'),
  );
}

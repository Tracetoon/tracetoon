import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { isPathUnder } from '@showtail/agent-traces/paths/pathUtil';
import { shellSegments } from '../util/shell.ts';

const win = process.platform === 'win32';

/** The spellings a path can take inside a log file: native, forward-slash, JSON-escaped. */
function spellings(root: string): string[] {
  const fwd = root.replace(/\\/g, '/');
  const back = root.replace(/\//g, '\\');
  // native, forward slashes, JSON-escaped once, and twice (Antigravity IDE args)
  const forms = new Set([
    root,
    fwd,
    back,
    back.replace(/\\/g, '\\\\'),
    back.replace(/\\/g, '\\\\\\\\'),
  ]);
  // Git Bash / MSYS spelling of a Windows drive path: C:\x -> /c/x
  const drive = /^([A-Za-z]):\//.exec(fwd);
  if (drive) forms.add(`/${drive[1]!.toLowerCase()}${fwd.slice(2)}`);
  return [...forms].map((f) => (win ? f.toLowerCase() : f));
}

/** Whether raw log text mentions any of the roots in any common spelling. */
export function mentionsAnyRoot(text: string, roots: string[]): boolean {
  const hay = win ? text.toLowerCase() : text;
  return roots.some((r) => spellings(r).some((s) => includesPath(hay, s)));
}

/** `needle` occurs in `hay` as a whole path: not followed by more name characters. */
function includesPath(hay: string, needle: string): boolean {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const next = hay[i + needle.length];
    if (next === undefined || !/[A-Za-z0-9_.-]/.test(next)) return true;
  }
  return false;
}

// cmd.exe's `cd /d <dir>` also changes drive; the switch is skipped only when a
// folder follows it, so a POSIX `cd /d` still means the folder /d.
const CD =
  /^(?:cd(?:\s+\/d(?=\s+[^\s;&|]))?|pushd|Set-Location|sl)\s+(?:-Path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/i;
const GIT_C =
  /^git\s+(?:(?:-c\s+\S+|--no-pager|--no-optional-locks|-P)\s+)*-C\s+("[^"]+"|'[^']+'|[^\s;&|]+)/;

/** A `cd` or `git -C` argument as a directory, from `base`; undefined when it can't be told. */
function dirArg(arg: string, base: string | undefined): string | undefined {
  let dir = arg.replace(/^["']|["']$/g, '');
  if (dir === '~' || dir.startsWith('~/') || dir.startsWith('~\\'))
    dir = homedir() + dir.slice(1);
  // Git Bash spelling of a Windows drive path: /c/x -> C:/x
  const msys = win ? /^\/([A-Za-z])(\/|$)/.exec(dir) : null;
  if (msys) dir = `${msys[1]!.toUpperCase()}:/${dir.slice(3)}`;
  if (isAbsolute(dir)) return resolve(dir);
  return base && isAbsolute(base) ? resolve(base, dir) : undefined;
}

/**
 * Where a command moves before its work: `cd x && ...` (and further `cd`s
 * chained by `&&` or `;`), `pushd x`, `Set-Location x`, or a git command's
 * `git -C x`. `moved` says it moves; `dir` is where, when that can be told.
 */
function movedTo(
  cmd: string,
  cwd: string | undefined,
): { moved: boolean; dir: string | undefined } {
  let moved = false;
  let dir = cwd;
  const parts = shellSegments(cmd);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!.command;
    const cd = CD.exec(seg);
    const git = cd ? undefined : GIT_C.exec(seg);
    if (!cd && !git) break;
    moved = true;
    dir = dirArg((cd ?? git)![1]!, dir);
    if (git || !dir) break;
    const next = parts[i + 1]?.before;
    if (next !== '&&' && next !== ';' && next !== '\n') break;
  }
  return { moved, dir: moved ? dir : undefined };
}

/**
 * The directory a command really runs in when it starts by changing directory
 * (`cd x && ...`, `pushd x`, `Set-Location x`, `git -C x ...`). Agents log a
 * command with the directory the shell was in *before* it ran, so without
 * this a `cd ../other-repo && bun test` is filed under the wrong repository.
 */
export function leadingCd(cmd: string, cwd: string | undefined): string | undefined {
  return movedTo(cmd, cwd).dir;
}

/**
 * Whether a command may have run in this repository: in one of its roots
 * (the checkout, its worktrees), in a folder holding one, or naming one.
 * False only when it clearly ran in another folder (`cd ../other && bun
 * test`, or an agent's own working directory elsewhere), so another
 * repository's checks are not read as this one's. Unsure (no folder, or one
 * that is relative to nothing known) means true.
 */
export function runsInRepo(
  cmd: string,
  cwd: string | undefined,
  roots: string[],
): boolean {
  const { moved, dir: to } = movedTo(cmd, cwd);
  const dir = moved ? to : cwd;
  if (!dir || !isAbsolute(dir) || !roots.length) return true;
  if (underAnyRoot(dir, roots) || roots.some((r) => isPathUnder(r, dir))) return true;
  return mentionsAnyRoot(cmd, roots);
}

/**
 * Whether a command provably ran in this repository: the folder it ran in
 * (after any leading `cd` or `git -C`) is known, absolute and inside one of
 * the roots. Stricter than `runsInRepo`, where unsure means yes.
 */
export function provablyInRepo(
  cmd: string,
  cwd: string | undefined,
  roots: string[],
): boolean {
  const { moved, dir: to } = movedTo(cmd, cwd);
  const dir = moved ? to : cwd;
  return !!dir && isAbsolute(dir) && underAnyRoot(dir, roots);
}

/** Whether `p` is one of the roots or inside one. */
export function underAnyRoot(p: string | undefined, roots: string[]): boolean {
  if (!p) return false;
  return roots.some((r) => isPathUnder(p, r));
}

/** The root containing `p`, if any (longest match wins, for nested worktrees). */
export function rootOf(p: string, roots: string[]): string | undefined {
  return roots.filter((r) => isPathUnder(p, r)).sort((a, b) => b.length - a.length)[0];
}

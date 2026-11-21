/**
 * An `sh` for hosts that start hooks as `sh -c "<command>"` on Windows too
 * (Goose does). A program started from the Start menu or Explorer gets the
 * persistent PATH from the registry, not the PATH of whichever shell ran
 * `tracetoon setup` (often Git Bash, which does have `sh`), so that is the
 * PATH checked here.
 *
 * `tracetoon setup --fix-sh` appends Git for Windows' usr\bin folder to the
 * user PATH, or, without Git, a folder holding Tracetoon's own `sh` shim
 * (src/util/shShim.ts). The addition is recorded in sh-path.json so
 * uninstalling removes exactly what was added.
 */
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { installLayout } from '../update/layout.ts';
import { run } from '../util/exec.ts';

type Env = NodeJS.ProcessEnv;

export const USER_ENV = 'HKCU\\Environment';
export const MACHINE_ENV =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

export interface RegValue {
  type: 'REG_SZ' | 'REG_EXPAND_SZ';
  value: string;
}

/** The registry, as far as this module needs it. Tests pass a fake. */
export interface Reg {
  get(key: string, name: string): RegValue | undefined;
  set(key: string, name: string, v: RegValue): void;
  /** Tell running programs (Explorer, so the next app it starts) that the environment changed. */
  broadcast(): void;
}

/** One `reg query` value: `    Path    REG_EXPAND_SZ    C:\a;%X%\b`. */
export function parseRegQuery(stdout: string, name: string): RegValue | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s+(\S.*?)\s{2,}(REG_SZ|REG_EXPAND_SZ)(?:\s{2,}(.*))?\s*$/.exec(line);
    if (m && m[1]!.toLowerCase() === name.toLowerCase())
      return { type: m[2] as RegValue['type'], value: m[3] ?? '' };
  }
  return undefined;
}

export const windowsReg: Reg = {
  get(key, name) {
    const r = run('reg', ['query', key, '/v', name], { timeoutMs: 5000 });
    return r.ok ? parseRegQuery(r.stdout, name) : undefined;
  },
  set(key, name, v) {
    const r = run('reg', ['add', key, '/v', name, '/t', v.type, '/d', v.value, '/f'], {
      timeoutMs: 5000,
    });
    if (!r.ok) throw new Error(`could not write ${key}\\${name}: ${r.stderr.trim()}`);
  },
  broadcast() {
    // WM_SETTINGCHANGE "Environment", as System Properties sends it. Best effort.
    const script =
      'Add-Type -Namespace T -Name W -MemberDefinition \'[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.UIntPtr w, string l, uint f, uint t, out System.UIntPtr r);\'; ' +
      '$r = [UIntPtr]::Zero; [void][T.W]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$r)';
    run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeoutMs: 15000,
    });
  },
};

/** `%VAR%` references expanded from `env`; unknown ones are left as they are. */
export function expandVars(value: string, env: Env): string {
  return value.replace(/%([^%;]+)%/g, (all, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key && env[key] !== undefined ? env[key]! : all;
  });
}

const splitPath = (p: string) =>
  p
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

const sameDir = (a: string, b: string) =>
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/** The PATH a program started from Explorer or the Start menu gets: machine entries, then user entries. */
export function persistentPath(reg: Reg, env: Env): string[] {
  const machine = reg.get(MACHINE_ENV, 'Path')?.value ?? '';
  const user = reg.get(USER_ENV, 'Path')?.value ?? '';
  return [...splitPath(machine), ...splitPath(user)].map((d) => expandVars(d, env));
}

export interface Fs {
  isFile(path: string): boolean;
}

export const realFs: Fs = {
  isFile(p) {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  },
};

/** Git for Windows' usr\bin (where its sh.exe is), if Git is installed. */
export function gitUsrBin(reg: Reg, env: Env, fs: Fs = realFs): string | undefined {
  const roots: string[] = [];
  for (const hive of ['HKLM', 'HKCU']) {
    const installed = reg.get(`${hive}\\SOFTWARE\\GitForWindows`, 'InstallPath')?.value;
    if (installed) roots.push(installed);
  }
  if (env.ProgramFiles) roots.push(join(env.ProgramFiles, 'Git'));
  if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'Programs', 'Git'));
  // git.exe on the persistent PATH lives in <root>\cmd or <root>\bin.
  for (const dir of persistentPath(reg, env))
    if (fs.isFile(join(dir, 'git.exe'))) roots.push(dirname(dir));
  for (const root of roots) {
    const bin = join(root, 'usr', 'bin');
    if (fs.isFile(join(bin, 'sh.exe'))) return bin;
  }
  return undefined;
}

/** Where Tracetoon's own `sh` shim goes. */
export const shimDir = (env: Env = process.env) =>
  join(installLayout(env).homeRoot, 'shim');

export interface ShState {
  /** The sh.exe a host would start, if any. */
  found?: string;
  /** Git for Windows' usr\bin, the preferred fix. */
  gitUsrBin?: string;
  /** Tracetoon's shim folder, when the shim is installed. */
  shim?: string;
}

export interface ShDeps {
  reg?: Reg;
  env?: Env;
  fs?: Fs;
  platform?: NodeJS.Platform;
}

/**
 * Whether a host started from the Start menu finds `sh`, searched the way
 * Rust's Command does on Windows: `programDirs` (the host's own exe folders),
 * System32, the Windows folder, then the persistent PATH.
 */
export function findSh(deps: ShDeps = {}, programDirs: string[] = []): ShState {
  const env = deps.env ?? process.env;
  const fs = deps.fs ?? realFs;
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') return { found: 'sh' };
  const reg = deps.reg ?? windowsReg;
  const windir = env.SystemRoot || env.windir || 'C:\\Windows';
  const dirs = [
    ...programDirs,
    join(windir, 'System32'),
    windir,
    ...persistentPath(reg, env),
  ];
  const found = dirs.map((d) => join(d, 'sh.exe')).find((p) => fs.isFile(p));
  const shim = shimDir(env);
  return {
    found,
    gitUsrBin: gitUsrBin(reg, env, fs),
    shim: fs.isFile(join(shim, 'sh.exe')) ? shim : undefined,
  };
}

/** The record of what `--fix-sh` added to the user PATH. */
export interface ShFixRecord {
  added: string;
  kind: 'git' | 'shim';
  at: string;
}

const recordFile = (env: Env) => join(installLayout(env).homeRoot, 'sh-path.json');

export function readShFix(env: Env = process.env): ShFixRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(recordFile(env), 'utf8'));
    return typeof r?.added === 'string' ? r : undefined;
  } catch {
    return undefined;
  }
}

/** Make (or refresh) the shim: a hard link to this tracetoon.exe named sh.exe. */
export function placeShim(exe: string, env: Env = process.env): string {
  const dir = shimDir(env);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'sh.exe');
  rmSync(target, { force: true });
  try {
    linkSync(exe, target);
  } catch {
    // Another volume: a link isn't possible, so copy (the shim is the whole runtime).
    writeFileSync(target, readFileSync(exe));
  }
  return dir;
}

/** Re-link the shim after `update` replaced tracetoon.exe, if the shim is in use. */
export function refreshShim(exe: string, env: Env = process.env): void {
  if (readShFix(env)?.kind !== 'shim') return;
  try {
    placeShim(exe, env);
  } catch {
    /* a running hook may hold the old link; the old binary still works as a shim */
  }
}

export interface ShFix {
  result: 'unchanged' | 'added';
  kind: 'found' | 'git' | 'shim';
  dir: string;
}

/**
 * Give hooks an `sh`: Git for Windows' usr\bin when Git is installed, otherwise
 * Tracetoon's shim (a link to `exe`). Appended to the user PATH (after the
 * machine PATH, so it shadows nothing that already resolves), keeping the
 * value's registry type.
 */
export function fixSh(exe: string | undefined, deps: ShDeps = {}): ShFix {
  const env = deps.env ?? process.env;
  const reg = deps.reg ?? windowsReg;
  const state = findSh({ ...deps, reg, env });
  if (state.found)
    return { result: 'unchanged', kind: 'found', dir: dirname(state.found) };
  if (!state.gitUsrBin && !exe)
    throw new Error('no Git for Windows and no standalone tracetoon.exe to link as sh');
  const kind = state.gitUsrBin ? 'git' : 'shim';
  const dir = state.gitUsrBin ?? placeShim(exe!, env);
  const current = reg.get(USER_ENV, 'Path');
  const entries = splitPath(current?.value ?? '');
  if (!entries.some((e) => sameDir(expandVars(e, env), dir))) {
    const backups = join(installLayout(env).homeRoot, 'backups');
    mkdirSync(backups, { recursive: true });
    writeFileSync(
      join(backups, `user-path-${Date.now()}.json`),
      JSON.stringify(current ?? null, null, 2) + '\n',
    );
    reg.set(USER_ENV, 'Path', {
      type: current?.type ?? 'REG_EXPAND_SZ',
      value: [...entries, dir].join(';'),
    });
    reg.broadcast();
  }
  const record: ShFixRecord = { added: dir, kind, at: new Date().toISOString() };
  mkdirSync(dirname(recordFile(env)), { recursive: true });
  writeFileSync(recordFile(env), JSON.stringify(record, null, 2) + '\n');
  return { result: 'added', kind, dir };
}

/** Undo `fixSh`: remove only the PATH entry it added, and the shim. */
export function unfixSh(deps: ShDeps = {}): string | undefined {
  const env = deps.env ?? process.env;
  const reg = deps.reg ?? windowsReg;
  const record = readShFix(env);
  if (!record) return undefined;
  const current = reg.get(USER_ENV, 'Path');
  if (current) {
    const entries = splitPath(current.value);
    const kept = entries.filter((e) => !sameDir(expandVars(e, env), record.added));
    if (kept.length !== entries.length) {
      reg.set(USER_ENV, 'Path', { type: current.type, value: kept.join(';') });
      reg.broadcast();
    }
  }
  if (record.kind === 'shim') rmSync(shimDir(env), { recursive: true, force: true });
  rmSync(recordFile(env), { force: true });
  return record.added;
}

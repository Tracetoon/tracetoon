/**
 * Goose starts every plugin hook as `sh -c "<command>"`, Windows included
 * (crates/goose/src/hooks/mod.rs, `hook_command`), so on Windows the hook needs
 * an `sh` that Goose Desktop can find. Rust's Command looks in goose.exe's own
 * folder first, then where src/hook/windowsSh.ts looks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findSh, type ShDeps, type ShState } from '../../hook/windowsSh.ts';
import { gooseDataDir } from './trace.ts';

type Env = NodeJS.ProcessEnv;

/** Folders holding a goose.exe: the desktop app's bundled CLI and the winget CLI. */
export function gooseExeDirs(env: Env): string[] {
  const local = env.LOCALAPPDATA;
  if (!local) return [];
  const dirs = [join(local, 'Programs', 'Goose', 'resources', 'bin')];
  const winget = join(local, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const name of readdirSync(winget))
      if (/goose/i.test(name)) dirs.push(join(winget, name, 'goose-package'));
  } catch {
    /* no winget packages */
  }
  return dirs;
}

/** Whether Goose (desktop or CLI) can find `sh` to run its hooks. */
export const gooseSh = (deps: ShDeps = {}): ShState =>
  findSh(deps, gooseExeDirs(deps.env ?? process.env));

export interface HookFailures {
  count: number;
  last?: { at: string; event?: string; error: string };
}

const FAILURE = /Plugin hook (?:failed|could not be executed)/;

/**
 * Hook runs Goose itself logged as failed for Tracetoon's plugin, in its newest
 * logs. A hook that never starts can't record anything in hook-health.json;
 * this is the only place such failures show up.
 */
export function gooseHookFailures(
  env: Env = process.env,
  home = homedir(),
  since = Date.now() - 7 * 24 * 3600 * 1000,
): HookFailures {
  const logs = join(gooseDataDir(env, home), 'logs');
  const files: { path: string; mtime: number }[] = [];
  for (const kind of ['cli', 'server']) {
    let days: string[] = [];
    try {
      days = readdirSync(join(logs, kind));
    } catch {
      continue;
    }
    for (const day of days)
      try {
        for (const f of readdirSync(join(logs, kind, day))) {
          const path = join(logs, kind, day, f);
          const mtime = statSync(path).mtimeMs;
          if (f.endsWith('.log') && mtime >= since) files.push({ path, mtime });
        }
      } catch {
        /* not a folder */
      }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out: HookFailures = { count: 0 };
  for (const { path } of files.slice(0, 10)) {
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('tracetoon') || !FAILURE.test(line)) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const f = entry?.fields ?? {};
      if (f.plugin !== 'tracetoon' || !FAILURE.test(String(f.message ?? ''))) continue;
      const at = String(entry.timestamp ?? '');
      if (at && Date.parse(at) < since) continue;
      out.count++;
      if (!out.last || at > out.last.at)
        out.last = { at, event: f.event, error: String(f.error ?? f.message) };
    }
  }
  return out;
}

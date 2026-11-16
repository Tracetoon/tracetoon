/**
 * Comic notices the user has already seen, so each is said once: why a repo
 * gets no comic, that no image route is set up (or one broke), that MCP can't
 * draw, and how to turn comics off. Kept beside the user's config
 * (`comic-notices.json`); a failed read or write never blocks anything.
 */
import { dirname, join } from 'node:path';
import { userConfigPath } from '../config.ts';
import { readLocal, writeLocal } from '../util/localJson.ts';

interface Notices {
  /** Notice key -> when it was shown. */
  seen?: Record<string, string>;
}

export const noticesPath = (env: NodeJS.ProcessEnv = process.env) =>
  join(dirname(env.TRACETOON_CONFIG ?? userConfigPath()), 'comic-notices.json');

const read = (env: NodeJS.ProcessEnv): Notices =>
  readLocal<Notices>(noticesPath(env)) ?? {};

export function noticeSeen(key: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!read(env).seen?.[key];
}

/** Record notices as shown. Best effort: a read-only config folder must not fail a publish. */
export function markNoticesSeen(
  keys: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!keys.length) return;
  try {
    const n = read(env);
    const at = new Date().toISOString();
    const seen = { ...n.seen };
    for (const k of keys) seen[k] = at;
    writeLocal(noticesPath(env), { ...n, seen });
  } catch {
    /* best effort */
  }
}

/** Forget notices whose key starts with `prefix` (a route that works again may break again). */
export function forgetNotices(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    const n = read(env);
    if (!n.seen) return;
    const seen = Object.fromEntries(
      Object.entries(n.seen).filter(([k]) => !k.startsWith(prefix)),
    );
    if (Object.keys(seen).length !== Object.keys(n.seen).length)
      writeLocal(noticesPath(env), { ...n, seen });
  } catch {
    /* best effort */
  }
}

/** Keys, in one place so render, publish, prepare and `images --dismiss` agree. */
export const noticeKey = {
  /** A repo that says no to comics (its rules, or its `comic` setting), per reason. */
  repoNo: (repo: string, why: string) => `repo-no:${repo}:${why}`,
  /** Comics included under `always` in a repo whose rules forbid images. */
  alwaysOverBan: (repo: string, why: string) => `always-over-ban:${repo}:${why}`,
  /** The settings hint after the user skips a comic, once per repo. */
  skipHint: (repo: string) => `skip-hint:${repo}`,
  /** No usable image route: `setup` and `approve` share one key; a broken route has its own. */
  route: (kind: 'setup' | 'approve' | 'fix', route?: string) =>
    kind === 'fix' ? `route:fix:${route ?? ''}` : 'route:setup',
  mcp: 'mcp',
};

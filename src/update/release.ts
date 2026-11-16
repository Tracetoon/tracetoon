/** Finding the release to install: GitHub's releases list, or a test server named by TRACETOON_UPDATE_URL. */
import { run } from '../util/exec.ts';
import { compareVersions, isPrerelease, parseVersion } from './version.ts';

export interface Release {
  tag: string;
  version: string;
  prerelease: boolean;
  publishedAt: string;
  notes: string;
}

export type Channel = 'stable' | 'latest';

const REPO = 'Tracetoon/tracetoon';

export function sources(env: NodeJS.ProcessEnv = process.env) {
  const base = env.TRACETOON_UPDATE_URL?.replace(/\/+$/, '');
  return base
    ? {
        list: `${base}/releases`,
        download: (tag: string, file: string) => `${base}/download/${tag}/${file}`,
      }
    : {
        list: `https://api.github.com/repos/${REPO}/releases?per_page=30`,
        download: (tag: string, file: string) =>
          `https://github.com/${REPO}/releases/download/${tag}/${file}`,
      };
}

let cachedToken: { value: string | undefined } | undefined;

/**
 * A token for GitHub's API. Without one, requests share the anonymous limit of 60 an
 * hour per IP address, which other tools on the machine (and every agent session's
 * update check) use up. GH_TOKEN or GITHUB_TOKEN wins; otherwise the gh CLI's own
 * login, looked up once per process. With a test server (TRACETOON_UPDATE_URL) the gh
 * lookup is skipped; the token still never reaches that host (see requestHeaders).
 */
export function githubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (env.TRACETOON_UPDATE_URL) return undefined;
  if (!cachedToken) {
    const r = run('gh', ['auth', 'token', '--hostname', 'github.com'], {
      env: { ...env, GH_PROMPT_DISABLED: '1' },
      timeoutMs: 5_000,
    });
    cachedToken = { value: r.ok && r.stdout.trim() ? r.stdout.trim() : undefined };
  }
  return cachedToken.value;
}

/** Headers for a request: the token goes to GitHub's API only, never to download hosts. */
export function requestHeaders(url: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': 'tracetoon-update',
    accept: 'application/vnd.github+json',
  };
  if (token && new URL(url).hostname === 'api.github.com')
    headers.authorization = `Bearer ${token}`;
  return headers;
}

/** A readable reason for a failed response; a used-up rate limit says when it resets and what to do. */
export function failureMessage(
  url: string,
  status: number,
  headers: Headers,
  withToken: boolean,
): string {
  const limited =
    (status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0';
  if (!limited) return `${url}: HTTP ${status}`;
  const reset = Number(headers.get('x-ratelimit-reset'));
  const when =
    Number.isFinite(reset) && reset > 0
      ? ` until ${new Date(reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';
  return withToken
    ? `GitHub's API rate limit for this token is used up${when}. Try again then.`
    : `GitHub's API rate limit for unauthenticated requests is used up${when}. Sign in with \`gh auth login\` or set GH_TOKEN, then try again.`;
}

async function get(url: string, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const attempt = (token?: string) =>
    fetch(url, {
      redirect: 'follow',
      headers: requestHeaders(url, token),
      signal: AbortSignal.timeout(60_000),
    });
  const token = new URL(url).hostname === 'api.github.com' ? githubToken(env) : undefined;
  let res = await attempt(token);
  let withToken = !!token;
  // A stale or revoked token shouldn't block an update the anonymous limit allows.
  if (token && res.status === 401) {
    res = await attempt();
    withToken = false;
  }
  if (!res.ok) throw new Error(failureMessage(url, res.status, res.headers, withToken));
  return res;
}

export const fetchText = async (url: string, env?: NodeJS.ProcessEnv) =>
  (await get(url, env)).text();
export const fetchBytes = async (url: string, env?: NodeJS.ProcessEnv) =>
  new Uint8Array(await (await get(url, env)).arrayBuffer());

/** Parse a releases list. Drafts and tags that are not versions are skipped. */
export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) return [];
  const out: Release[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
    if (!parseVersion(tag) || r.draft || typeof r.published_at !== 'string') continue;
    out.push({
      tag,
      version: tag.replace(/^v/, ''),
      prerelease: r.prerelease === true || isPrerelease(tag),
      publishedAt: r.published_at,
      notes: typeof r.body === 'string' ? r.body : '',
    });
  }
  return out;
}

/**
 * The newest published release in the channel. GitHub lists by tag name (rc.10 before
 * rc.2), so order by publish time, with the version breaking ties.
 */
export function pickRelease(releases: Release[], channel: Channel): Release | undefined {
  return releases
    .filter((r) => channel === 'latest' || !r.prerelease)
    .sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) || compareVersions(b.tag, a.tag),
    )[0];
}

export async function listReleases(env: NodeJS.ProcessEnv = process.env) {
  return parseReleases(JSON.parse(await fetchText(sources(env).list, env)));
}

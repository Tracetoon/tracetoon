import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  failureMessage,
  githubToken,
  listReleases,
  requestHeaders,
} from '../src/update/release.ts';

const API = 'https://api.github.com/repos/Tracetoon/tracetoon/releases?per_page=30';
const DOWNLOAD =
  'https://github.com/Tracetoon/tracetoon/releases/download/v1.0.0/checksums.txt';

test('GH_TOKEN, then GITHUB_TOKEN; a test server gets no token', () => {
  expect(githubToken({ GH_TOKEN: ' a ', GITHUB_TOKEN: 'b' })).toBe('a');
  expect(githubToken({ GITHUB_TOKEN: 'b' })).toBe('b');
  expect(githubToken({ TRACETOON_UPDATE_URL: 'http://127.0.0.1:1' })).toBeUndefined();
});

test('the token goes to the API only, never to download hosts', () => {
  expect(requestHeaders(API, 't').authorization).toBe('Bearer t');
  expect(requestHeaders(DOWNLOAD, 't').authorization).toBeUndefined();
  expect(
    requestHeaders('http://127.0.0.1:1/releases', 't').authorization,
  ).toBeUndefined();
  expect(requestHeaders(API).authorization).toBeUndefined();
});

test('a used-up rate limit says so, when it resets, and what to do', () => {
  const limited = new Headers({
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': '1794806416',
  });
  const anon = failureMessage(API, 403, limited, false);
  expect(anon).toStartWith(
    "GitHub's API rate limit for unauthenticated requests is used up until ",
  );
  expect(anon).toEndWith('Sign in with `gh auth login` or set GH_TOKEN, then try again.');
  expect(failureMessage(API, 429, limited, true)).toStartWith(
    "GitHub's API rate limit for this token is used up until ",
  );
  // Any other failure keeps the plain status.
  expect(failureMessage(API, 403, new Headers(), false)).toBe(`${API}: HTTP 403`);
  expect(failureMessage(API, 500, limited, false)).toBe(`${API}: HTTP 500`);
});

let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794806416' },
      }),
  });
});
afterAll(() => server.stop(true));

test('listing releases against a rate-limited server explains the 403', async () => {
  const env = { TRACETOON_UPDATE_URL: `http://127.0.0.1:${server.port}` };
  await expect(listReleases(env)).rejects.toThrow(
    /rate limit for unauthenticated requests is used up until .*Sign in with `gh auth login`/,
  );
});

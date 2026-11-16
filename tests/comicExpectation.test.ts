/** Whether a PR should get a comic: decided by Tracetoon up front, not left to the agent. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comicExpectation, comicStep } from '../src/comic/expectation.ts';
import { forgetNotices, markNoticesSeen, noticeKey } from '../src/comic/notices.ts';
import { comicSource } from '../src/config.ts';
import { tempDir } from './helpers.ts';

const KEYS = [
  'TRACETOON_CONFIG',
  'TRACETOON_CODEX_BIN',
  'TRACETOON_AGY_BIN',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.TRACETOON_CONFIG = join(tempDir(), 'config.json');
  // No image route at all unless a test adds one.
  process.env.TRACETOON_CODEX_BIN = 'none';
  process.env.TRACETOON_AGY_BIN = 'none';
  for (const k of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
  ])
    delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

const userConfig = (c: object) =>
  writeFileSync(process.env.TRACETOON_CONFIG!, JSON.stringify(c));
const repoWith = (repoConfig?: object) => {
  const root = tempDir();
  if (repoConfig) {
    mkdirSync(join(root, '.github'));
    writeFileSync(join(root, '.github', 'tracetoon.json'), JSON.stringify(repoConfig));
  }
  return root;
};
/** An OpenAI key and the user's OK: a route that can draw. */
const readyRoute = (extra: object = {}) => {
  process.env.OPENAI_API_KEY = 'sk-test';
  userConfig({ imageConsent: ['openai'], ...extra });
};
const none = { media: 'none' as const };
const ban = {
  media: 'prohibited' as const,
  mediaSource: { file: 'CONTRIBUTING.md', line: 7, text: 'no images in PRs' },
};
const request = {
  media: 'requested' as const,
  mediaRequest: { file: 'CONTRIBUTING.md', line: 8, text: 'comic included' },
};

describe('comic expectation', () => {
  test('default allowed with a ready route: expected, and the step says to draw it', () => {
    readyRoute();
    const e = comicExpectation(repoWith(), none);
    expect(e).toMatchObject({
      expected: true,
      route: { kind: 'ready' },
      askSetup: false,
    });
    expect(comicStep(e)).toContain('draw the comic (SKILL step 5)');
    expect(comicStep(e)).toContain('tracetoon comic skip');
  });

  test("a repo's request is cited in the step", () => {
    readyRoute();
    const e = comicExpectation(repoWith(), request);
    expect(e.why).toContain('this repo asks for comics (CONTRIBUTING.md:8)');
    expect(comicStep(e)).toContain('this repo asks for one: CONTRIBUTING.md:8');
  });

  test("the user's off: not expected, and no step at all", () => {
    userConfig({ comic: 'off' });
    const e = comicExpectation(repoWith(), request);
    expect(e).toMatchObject({ expected: false, state: 'off' });
    expect(comicStep(e)).toBe('');
  });

  test("a repo ban or the repo's off under allowed: not expected, said as the repo's", () => {
    expect(comicExpectation(repoWith(), ban)).toMatchObject({
      expected: false,
      state: 'policy',
      why: "this repo's rules forbid images in PRs (CONTRIBUTING.md:7)",
    });
    const root = repoWith({ comic: 'off' });
    expect(comicSource(root)).toBe('repo');
    expect(comicExpectation(root, none)).toMatchObject({
      expected: false,
      state: 'repo-off',
    });
  });

  test("always beats a repo ban and the repo's off", () => {
    readyRoute({ comic: 'always' });
    expect(comicExpectation(repoWith({ comic: 'off' }), ban)).toMatchObject({
      expected: true,
      why: 'your comic setting is always',
    });
  });

  test('no route: expected, setup asked once per machine, and dismissing stops it', () => {
    const root = repoWith();
    const first = comicExpectation(root, none);
    expect(first).toMatchObject({
      expected: true,
      route: { kind: 'setup' },
      askSetup: true,
    });
    expect(comicStep(first)).toContain('raise this once with the user');
    markNoticesSeen([noticeKey.route('setup')]);
    const later = comicExpectation(root, none);
    expect(later.askSetup).toBe(false);
    expect(comicStep(later)).toBe('');
  });

  test('a route that breaks after working is asked about once more', () => {
    markNoticesSeen([noticeKey.route('setup')]);
    // A broken route has its own key, so its first appearance is news.
    expect(noticeKey.route('fix', 'codex')).not.toBe(noticeKey.route('setup'));
    markNoticesSeen([noticeKey.route('fix', 'codex')]);
    forgetNotices('route:');
    expect(comicExpectation(repoWith(), none).askSetup).toBe(true);
  });
});

describe("prepare's next steps", () => {
  test('carry the comic step before publish when one is expected, and nothing when off', async () => {
    const { graphNext } = await import('../src/commands/digest.ts');
    readyRoute();
    const on = graphNext('r1', undefined, comicExpectation(repoWith(), none));
    expect(on).toContain('draw the comic (SKILL step 5)');
    expect(on).toContain('tracetoon comic skip --run r1');
    expect(on.indexOf('draw the comic')).toBeLessThan(on.indexOf('publish when'));
    userConfig({ comic: 'off' });
    expect(graphNext('r1', undefined, comicExpectation(repoWith(), none))).not.toContain(
      'comic',
    );
  });
});

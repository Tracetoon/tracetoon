/** The short message an agent relays after Tracetoon creates the PR. */
import { describe, expect, test } from 'bun:test';
import {
  comicNotices,
  publishSummary,
  renderComicStatus,
  type Approval,
  type ComicStatus,
} from '../src/commands/publish.ts';
import { noticeKey } from '../src/comic/notices.ts';

const approval = (over: Partial<Approval> = {}): Approval => ({
  code: 'abc12345',
  title: 'Add a greeting',
  bodySha: 'x',
  findings: [],
  allowFindings: false,
  mode: 'create',
  base: 'main',
  head: 'feat/greeting',
  repo: 'o/r',
  policy: 'none',
  ambiguousSessions: [],
  comicMode: 'allowed',
  comicStatus: { state: 'included' },
  renderedAt: 'now',
  ...over,
});
const URL = 'https://github.com/o/r/pull/34';
/** A notice log in memory: what `seen` answers, and what a publish would record. */
const log = () => {
  const seen = new Set<string>();
  return {
    seen: (k: string) => seen.has(k),
    publish(a: Approval) {
      const message = publishSummary(a, URL, (k) => seen.has(k));
      for (const k of comicNotices(a, (k) => seen.has(k)).keys) seen.add(k);
      return message;
    },
  };
};

describe('post-PR message', () => {
  test('says Tracetoon created the PR and that it has a comic, without a settings nag', () => {
    expect(publishSummary(approval(), URL).split('\n')).toEqual([
      `Tracetoon created PR #34: ${URL}`,
      'Comic: included.',
    ]);
  });

  test('comics off in your own settings: nothing about comics, ever', () => {
    const message = publishSummary(
      approval({
        comicMode: 'off',
        comicStatus: { state: 'off', detail: 'comic is off in your settings' },
      }),
      URL,
    );
    expect(message).toBe(`Tracetoon created PR #34: ${URL}`);
  });

  test.each([
    {
      state: 'policy',
      detail: "this repo's rules forbid images in PRs (CONTRIBUTING.md:12)",
    },
    { state: 'repo-off', detail: 'this repo turns comics off (.github/tracetoon.json)' },
  ] as ComicStatus[])('a repo that says no is told once per repo: %o', (status) => {
    const l = log();
    const first = l.publish(approval({ comicStatus: status }));
    expect(first).toContain(
      `No comic: ${status.detail}. You won't see this again for this repo.`,
    );
    expect(first).not.toContain('Comics: tracetoon config set');
    expect(l.publish(approval({ comicStatus: status }))).not.toContain('omic');
    // Another repo with the same rule is told once too.
    expect(l.publish(approval({ repo: 'o/other', comicStatus: status }))).toContain(
      'No comic:',
    );
    // A different reason in the same repo is new information.
    expect(
      l.publish(
        approval({
          comicStatus: { state: 'policy', detail: 'another rule (README.md:4)' },
        }),
      ),
    ).toContain('No comic: another rule (README.md:4)');
  });

  test('no image route is said once per machine; a broken route once per break', () => {
    const l = log();
    const none: ComicStatus = {
      state: 'no-route',
      detail: 'no image route set up (tracetoon images)',
      route: { kind: 'setup' },
    };
    expect(l.publish(approval({ comicStatus: none }))).toContain(
      'Comic: none — no image route',
    );
    expect(l.publish(approval({ repo: 'o/other', comicStatus: none }))).not.toContain(
      'Comic',
    );
    const broken: ComicStatus = {
      state: 'no-route',
      detail: "the image route needs fixing (Codex CLI can't draw yet)",
      route: { kind: 'fix', id: 'codex' },
    };
    expect(l.publish(approval({ comicStatus: broken }))).toContain('needs fixing');
    expect(l.publish(approval({ comicStatus: broken }))).not.toContain('Comic');
  });

  test('a skip the user chose is echoed each time; the settings hint once per repo', () => {
    const l = log();
    const skipped: ComicStatus = {
      state: 'skipped',
      by: 'user',
      detail: 'the user declined it',
    };
    const first = l.publish(approval({ comicStatus: skipped }));
    expect(first).toContain('Comic: none — the user declined it.');
    expect(first).toContain(
      'Comics: tracetoon config set comic off|allowed|always (now: allowed)',
    );
    const second = l.publish(approval({ comicStatus: skipped }));
    expect(second).toContain('Comic: none — the user declined it.');
    expect(second).not.toContain('Comics: tracetoon config set');
  });

  test("an agent's skip says it was the agent's call", () => {
    const l = log();
    const skipped: ComicStatus = {
      state: 'skipped',
      by: 'agent',
      detail: 'no review value',
    };
    expect(l.publish(approval({ comicStatus: skipped }))).toContain(
      "Comic: none — no review value (the agent's call, not the user's).",
    );
  });

  test('MCP, which cannot draw, is said once per machine', () => {
    const l = log();
    const mcp: ComicStatus = {
      state: 'skipped',
      by: 'mcp',
      detail: "comics aren't drawn over MCP",
    };
    expect(l.publish(approval({ comicStatus: mcp }))).toContain(
      "comics aren't drawn over MCP",
    );
    expect(l.publish(approval({ repo: 'o/x', comicStatus: mcp }))).not.toContain('Comic');
    expect(l.seen(noticeKey.mcp)).toBe(true);
  });

  test('a failed drawing is reported every time, and a repo request is cited', () => {
    const l = log();
    const failed: ComicStatus = {
      state: 'failed',
      detail: 'the image service timed out',
      request: 'CONTRIBUTING.md:8',
    };
    for (let i = 0; i < 2; i++)
      expect(l.publish(approval({ comicStatus: failed }))).toContain(
        'Comic: none — the image service timed out (this repo asks for comics: CONTRIBUTING.md:8).',
      );
  });

  test('always over a repo ban: the note once per repo, then just "included"', () => {
    const l = log();
    const status: ComicStatus = { state: 'included', overBan: 'CONTRIBUTING.md:12' };
    expect(l.publish(approval({ comicMode: 'always', comicStatus: status }))).toContain(
      "Comic: included, although this repo's rules forbid images in PRs (CONTRIBUTING.md:12)",
    );
    expect(l.publish(approval({ comicMode: 'always', comicStatus: status }))).toContain(
      'Comic: included.',
    );
  });

  test('an update says so, and left-out sessions are mentioned', () => {
    const message = publishSummary(
      approval({ mode: 'edit', prNumber: 34, ambiguousSessions: ['h:1', 'h:2'] }),
      URL,
    );
    expect(message).toStartWith(`Tracetoon updated PR #34: ${URL}`);
    expect(message).toContain('Left out: 2 sessions that may not belong to this PR.');
  });

  test('renders from before comic status was recorded still produce a message', () => {
    const message = publishSummary(
      approval({ comicStatus: undefined, comicMode: undefined }),
      URL,
    );
    expect(message).toBe(`Tracetoon created PR #34: ${URL}`);
  });
});

describe('render comic status', () => {
  const base = {
    included: false,
    noComic: false,
    decision: { include: true } as const,
    policy: { media: 'none' as const },
    route: () => ({ kind: 'ready' as const, route: 'codex' as const, text: 'ready' }),
  };

  test('expected, a route can draw, nothing drawn or said: missing (publish refuses it)', () => {
    expect(renderComicStatus(base).state).toBe('missing');
  });

  test('a recorded reason is kept; a repo request is attached', () => {
    expect(
      renderComicStatus({
        ...base,
        recorded: { state: 'skipped', by: 'user', detail: 'the user declined it' },
        policy: {
          media: 'requested',
          mediaRequest: { file: 'CONTRIBUTING.md', line: 8, text: 'comic included' },
        },
      }),
    ).toEqual({
      state: 'skipped',
      by: 'user',
      detail: 'the user declined it',
      request: 'CONTRIBUTING.md:8',
    });
  });

  test('no usable route: published without one, never refused', () => {
    expect(
      renderComicStatus({ ...base, route: () => ({ kind: 'setup', text: 'No route' }) }),
    ).toMatchObject({ state: 'no-route', route: { kind: 'setup' } });
    expect(
      renderComicStatus({
        ...base,
        route: () => ({ kind: 'fix', route: 'codex', text: "Codex can't draw yet." }),
      }),
    ).toMatchObject({ state: 'no-route', route: { kind: 'fix', id: 'codex' } });
  });

  test('not expected: the decision says why and no route is looked at', () => {
    let looked = false;
    expect(
      renderComicStatus({
        ...base,
        decision: {
          include: false,
          state: 'off',
          reason: 'comic is off in your settings',
        },
        route: () => {
          looked = true;
          return { kind: 'setup', text: '' };
        },
      }),
    ).toEqual({ state: 'off', detail: 'comic is off in your settings' });
    expect(looked).toBe(false);
  });

  test('--no-comic is an explicit skip', () => {
    expect(renderComicStatus({ ...base, noComic: true })).toMatchObject({
      state: 'skipped',
      by: 'user',
    });
  });
});

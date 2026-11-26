/**
 * Whether this PR should get a comic, decided by Tracetoon once, up front,
 * instead of left to the agent: the user's setting, the repo's setting and
 * rules, and whether an image route can draw. Prepare prints it, render
 * enforces it, and publish says why when there is none.
 */
import { comicSource, loadConfig } from '../config.ts';
import type { AiPolicy } from '../github/repoContext.ts';
import { comicDecision } from './decision.ts';
import { noticeKey, noticeSeen } from './notices.ts';
import { nextStep, routeStatuses, type NextStep } from './routes.ts';

export interface ComicExpectation {
  /** A comic is expected on this PR: the agent draws it or records why not. */
  expected: boolean;
  /** Why not, when it isn't: the user's own `off` stays silent; the repo's no is told once. */
  state?: 'off' | 'repo-off' | 'policy';
  why: string;
  /** The repo asks for comics or images in PRs. */
  request?: { file: string; line: number; text: string };
  /** What drawing needs right now (`ready`, or setup to raise). */
  route: NextStep;
  /** Raise image setup with the user now: once per machine, and once again when a route breaks. */
  askSetup: boolean;
}

export function comicExpectation(
  root: string,
  policy: Pick<AiPolicy, 'media' | 'mediaSource' | 'mediaRequest'>,
  env: NodeJS.ProcessEnv = process.env,
): ComicExpectation {
  const mode = loadConfig(root).comic;
  const decision = comicDecision(mode, policy, comicSource(root));
  const request = policy.media === 'requested' ? policy.mediaRequest : undefined;
  // Routes are only looked at when a comic could be drawn: detection can start a CLI.
  const route: NextStep = decision.include
    ? nextStep(routeStatuses(root, false), mode)
    : { kind: 'setup', text: '' };
  if (!decision.include)
    return {
      expected: false,
      state: decision.state,
      why: decision.reason ?? '',
      route,
      askSetup: false,
    };
  const why =
    mode === 'always'
      ? 'your comic setting is always'
      : request
        ? `this repo asks for comics (${request.file}:${request.line})`
        : 'comics are on by default (comic: allowed)';
  const askSetup =
    route.kind !== 'ready' &&
    !noticeSeen(
      noticeKey.route(route.kind, 'route' in route ? route.route : undefined),
      env,
    );
  return {
    expected: true,
    why,
    ...(request ? { request } : {}),
    route,
    askSetup,
  };
}

/** The comic step in prepare's next steps, or '' when no comic is expected. */
export function comicStep(e: ComicExpectation): string {
  if (!e.expected) return '';
  const asked = e.request
    ? ` (this repo asks for one: ${e.request.file}:${e.request.line})`
    : '';
  if (e.route.kind === 'ready')
    return `draw the comic (references/full-path.md step 5)${asked}: once body.md is drafted, \`tracetoon comic packet --run <run>\` writes the comic author's packet; hand it to ONE fresh subagent as it says, then draw, render and run the quality loop; if the user declines it or drawing keeps failing, record why with \`tracetoon comic skip --run <run> --reason "<why>"\` (add \`--by user\` when the user declined it)`;
  if (e.askSetup)
    return `a comic is expected${asked}, but no image route can draw yet: raise this once with the user (with your question tool if you have one, else in chat): ${e.route.text} Ask for their yes yourself and, on a yes, run the command for them. If they say no, run \`tracetoon images --dismiss\` and offer \`tracetoon config set comic off\`; the PR is published without a comic. The PR doesn't have to wait for this answer: if you can't get it before the PR is ready, record \`tracetoon comic skip --run <run> --reason "image setup awaits the user's answer"\`, publish with the approval publishing normally needs, and ask in your final message`;
  return '';
}

/** The prefix of the line a delegated drafter adds to its final reply when image setup awaits the user. */
export const COMIC_SETUP_LINE = 'COMIC SETUP:';

/**
 * The comic step for a delegated drafter, or '' when no comic is expected or
 * due: `tracetoon comic run`, which starts the comic author and the judges
 * itself (the drafter can't start subagents or ask the user, on any host), so
 * it can run beside `tracetoon review run`. When the image route needs the
 * user, it records the skip and prints a COMIC SETUP line to relay.
 */
export function drafterComicStep(e: ComicExpectation, run: string): string {
  if (!e.expected || (e.route.kind !== 'ready' && !e.askSetup)) return '';
  const asked = e.request
    ? `; this repo asks for one: ${e.request.file}:${e.request.line}`
    : '';
  return `\`tracetoon comic run --run ${run}\` (the comic${asked}: Tracetoon starts a fresh comic author and fresh judges itself, draws, renders and runs the full quality loop, or records why there is none; it draws from the brief and your draft, so it doesn't wait for the review fixes, and render puts it beside the final body. It doesn't pause for the comic's setup answer (publishing keeps its own approval): when it prints a \`${COMIC_SETUP_LINE} …\` line, add that line to your final reply)`;
}

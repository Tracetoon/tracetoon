/** Whether this PR gets a comic, from the user's setting and the repo's rules. */
import type { ComicMode } from '../config.ts';

export interface ComicDecision {
  include: boolean;
  reason?: string;
  /**
   * Why not: the user's own setting, the repo's `comic` setting (only heard
   * when the user leaves it at `allowed`), or the repo's written rules.
   */
  state?: 'off' | 'repo-off' | 'policy';
}

export function comicDecision(
  mode: ComicMode,
  policy: { media?: string; mediaSource?: { file: string; line: number } },
  source: 'user' | 'repo' | 'default' = 'user',
): ComicDecision {
  if (mode === 'off')
    return source === 'repo'
      ? {
          include: false,
          state: 'repo-off',
          reason: 'this repo turns comics off (.github/tracetoon.json)',
        }
      : { include: false, state: 'off', reason: 'comic is off in your settings' };
  if (mode === 'allowed' && policy.media === 'prohibited') {
    const src = policy.mediaSource;
    return {
      include: false,
      state: 'policy',
      reason: `this repo's rules forbid images in PRs${src ? ` (${src.file}:${src.line})` : ''}`,
    };
  }
  return { include: true };
}

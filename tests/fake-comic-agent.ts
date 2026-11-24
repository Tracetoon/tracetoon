/**
 * The replies of a fake comic author and fake comic judges, for the fake
 * `claude -p` and `codex exec` stand-ins when `tracetoon comic run` starts
 * them. Never calls a model.
 *
 * FAKE_COMIC_AUTHOR_FIRST=bad: the author's first reply fails comic check, so
 * a correction round is exercised.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLIND_DIMENSIONS, GATES } from '../src/comic/judging.ts';
import { pageText } from '../src/comic/script.ts';
import type { ComicScript } from '../src/comic/types.ts';
import { pageScript } from './pageScript.ts';

export const COMIC_RUN_MARK = 'You were started by `tracetoon comic run`';

/** The reply for a comic-run prompt, or undefined when the prompt is something else. */
export function comicReply(prompt: string): string | undefined {
  // Corrections and rewrites go to the same (resumed) author session, without the mark.
  const followUp =
    prompt.startsWith('`tracetoon comic check` found these problems') ||
    prompt.startsWith('The quality loop asks');
  if (!prompt.includes(COMIC_RUN_MARK) && !followUp) return undefined;
  if (prompt.includes('as the comic author') || prompt.includes('found these problems')) {
    const bad =
      process.env.FAKE_COMIC_AUTHOR_FIRST === 'bad' && !prompt.includes('found these problems');
    return JSON.stringify({
      design: { concepts: ['one', 'two', 'three'], chosen: 1 },
      comic: bad ? { ...pageScript(), v: 1 } : pageScript(),
    });
  }
  if (!prompt.includes('found these problems') && prompt.includes('The quality loop asks'))
    return JSON.stringify({ design: {}, comic: pageScript() });
  // Either separator: the packet names its files with the platform's own (backslashes on Windows).
  const m = /(\S+)[\\/]judge[\\/](observe|phone|check|compare)-(c\d+)/.exec(prompt);
  if (!m) return '{}';
  const [, runDir, stage, candidate] = m;
  if (stage === 'observe')
    return JSON.stringify({
      panels: ['a developer and a glowing link'],
      text: [],
      apparentChange: 'a path became a link',
      mechanism: {
        state: 'none-identifiable',
        visibleSituation: 'before and after',
        devices: [],
        essentialClues: [],
        interpretation: 'none',
      },
      scores: Object.fromEntries(
        BLIND_DIMENSIONS.map((d) => [d, { state: 'assessed', score: 4, reason: 'r' }]),
      ),
    });
  if (stage === 'phone') {
    const script = JSON.parse(
      readFileSync(join(runDir!, 'candidates', candidate!, 'comic.json'), 'utf8'),
    ) as ComicScript;
    return JSON.stringify({
      items: pageText(script).map((words) => ({ panel: null, words, legible: 'yes' })),
      unreadable: [],
    });
  }
  if (stage === 'check')
    return JSON.stringify({
      gates: Object.fromEntries(GATES.map((g) => [g, { state: 'pass', reason: 'r' }])),
      prMeaning: { state: 'assessed', score: 4, reason: 'r' },
      issues: [],
    });
  return JSON.stringify({ preference: 'tie', reason: 'r' });
}

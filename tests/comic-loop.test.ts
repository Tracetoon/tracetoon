import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveCandidate,
  comicLoopCmd,
  comicLoopImportCmd,
  loadLoop,
  noteRender,
} from '../src/commands/comicLoop.ts';
import { BLIND_DIMENSIONS, GATES } from '../src/comic/judging.ts';
import { svgToPng } from '../src/comic/raster.ts';
import type { ComicScript } from '../src/comic/types.ts';

const script = {
  v: 2,
  title: 'T',
  panels: [{ scene: 's', dialogue: [{ speaker: 'Cat', text: 'SECRET PUNCHLINE' }] }],
  anchor: { change: 'secret change', terms: ['x'] },
} as unknown as ComicScript;

async function runDir(color = '#f00') {
  const dir = mkdtempSync(join(tmpdir(), 'loop-'));
  mkdirSync(join(dir, 'out'), { recursive: true });
  const png = await svgToPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${color}"/></svg>`,
  );
  writeFileSync(join(dir, 'out', 'comic.png'), png);
  writeFileSync(join(dir, 'title.txt'), 'PR title');
  writeFileSync(join(dir, 'body.md'), 'PR body');
  return { id: '20261116-000000', dir };
}
const quiet = { json: true } as const;

describe('comic loop', () => {
  test('archives each distinct render once, before it can be replaced', async () => {
    const run = await runDir();
    expect(archiveCandidate(run, script, true)).toBe('c1');
    expect(archiveCandidate(run, script, true)).toBe('c1');
    expect(existsSync(join(run.dir, 'candidates', 'c1', 'comic.png'))).toBe(true);
    expect(existsSync(join(run.dir, 'candidates', 'c1', 'comic.json'))).toBe(true);
    writeFileSync(
      join(run.dir, 'out', 'comic.png'),
      await svgToPng(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#00f"/></svg>',
      ),
    );
    expect(archiveCandidate(run, script, true)).toBe('c2');
    expect(loadLoop(run)!.candidates.map((c) => c.parent)).toEqual([null, 'c1']);
  });

  test('the cold-read packet holds only the image, never the script or PR', async () => {
    const run = await runDir();
    archiveCandidate(run, script, true);
    await comicLoopCmd(run, quiet);
    const dir = join(run.dir, 'judge', 'observe-c1');
    const text = readFileSync(join(dir, 'instructions.md'), 'utf8');
    expect(text).not.toContain('SECRET PUNCHLINE');
    expect(text).not.toContain('secret change');
    expect(text).not.toContain('PR body');
    expect(existsSync(join(dir, 'A-360.png'))).toBe(true);
  });

  test('imports answers, counts every judge call and needs a real agent id', async () => {
    const run = await runDir();
    archiveCandidate(run, script, true);
    await comicLoopCmd(run, quiet);
    const result = join(run.dir, 'judge', 'observe-c1', 'result.json');
    writeFileSync(result, JSON.stringify({ panels: [] }));
    expect(() => comicLoopImportCmd(run, { task: 'observe:c1', ...quiet })).toThrow(
      /agent-id/,
    );
    expect(() =>
      comicLoopImportCmd(run, { task: 'observe:c1', agentId: 'a1', ...quiet }),
    ).toThrow(/needs fixing/);
    expect(loadLoop(run)!.used.judgeCalls).toBe(1);
    writeFileSync(
      result,
      JSON.stringify({
        panels: ['a red square'],
        text: [],
        apparentChange: 'unclear',
        mechanism: {
          state: 'none-identifiable',
          visibleSituation: 'red',
          devices: [],
          essentialClues: [],
          interpretation: 'none',
        },
        scores: Object.fromEntries(
          BLIND_DIMENSIONS.map((d) => [d, { state: 'assessed', score: 4, reason: 'r' }]),
        ),
      }),
    );
    comicLoopImportCmd(run, { task: 'observe:c1', agentId: 'a2', ...quiet });
    await comicLoopCmd(run, quiet);
    // The phone reader gets only the 360px rendition: no larger image, no intended text.
    const phoneDir = join(run.dir, 'judge', 'phone-c1');
    expect(readdirSync(phoneDir).sort()).toEqual(['A-360.png', 'instructions.md']);
    expect(readFileSync(join(phoneDir, 'instructions.md'), 'utf8')).not.toContain(
      'SECRET PUNCHLINE',
    );
    writeFileSync(
      join(phoneDir, 'result.json'),
      JSON.stringify({
        items: [
          { panel: null, words: 'T', legible: 'yes' },
          { panel: 1, words: 'SECRET PUNCHLINE', legible: 'yes' },
        ],
        unreadable: [],
      }),
    );
    comicLoopImportCmd(run, { task: 'phone:c1', agentId: 'a2b', ...quiet });
    await comicLoopCmd(run, quiet);
    const check = readFileSync(
      join(run.dir, 'judge', 'check-c1', 'instructions.md'),
      'utf8',
    );
    expect(check).toContain('SECRET PUNCHLINE'); // the checker does get the facts
    writeFileSync(
      join(run.dir, 'judge', 'check-c1', 'result.json'),
      JSON.stringify({
        gates: Object.fromEntries(GATES.map((g) => [g, { state: 'pass', reason: 'r' }])),
        prMeaning: { state: 'assessed', score: 4, reason: 'r' },
        issues: [],
      }),
    );
    comicLoopImportCmd(run, { task: 'check:c1', agentId: 'a3', ...quiet });
    await comicLoopCmd(run, quiet);
    const s = loadLoop(run)!;
    expect(s.incumbent).toBe('c1');
    expect(s.used.judgeCalls).toBe(4);
  });

  test('render counting starts the budget', async () => {
    const run = await runDir();
    noteRender(run);
    noteRender(run);
    expect(loadLoop(run)!.used.renders).toBe(2);
  });
});

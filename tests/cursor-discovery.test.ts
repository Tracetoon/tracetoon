/**
 * Cursor files each session under a project folder named after the workspace
 * path. A session whose tools only used relative paths never names the repo in
 * its text, so discovery must also match on that folder.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cursorAdapter, cursorProjectName } from '../src/integrations/cursor/trace.ts';
import { tempDir } from './helpers.ts';

const saved = process.env.CURSOR_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.CURSOR_HOME;
  else process.env.CURSOR_HOME = saved;
});

function transcript(home: string, project: string, id: string) {
  const dir = join(home, 'projects', project, 'agent-transcripts', id);
  mkdirSync(dir, { recursive: true });
  const lines = [
    {
      role: 'user',
      message: {
        content: [
          { type: 'text', text: '<user_query>\nCreate notes.txt\n</user_query>' },
        ],
      },
    },
    {
      role: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Write',
            input: { path: 'notes.txt', contents: 'hi\n' },
          },
          { type: 'tool_use', name: 'Shell', input: { command: 'git status --short' } },
        ],
      },
    },
  ];
  writeFileSync(
    join(dir, `${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('Cursor discovery', () => {
  test('names a project folder the way Cursor does', () => {
    expect(cursorProjectName('/tmp/tracetoon-compat-cursor-cli-cyxif9/repo')).toBe(
      'tmp-tracetoon-compat-cursor-cli-cyxif9-repo',
    );
    expect(
      cursorProjectName(String.raw`C:\Users\dev\AppData\Local\Temp\x-TSbr6q\repo`),
    ).toBe('C-Users-dev-AppData-Local-Temp-x-TSbr6q-repo');
  });

  test("finds a session that never names the repo, by the repo's project folder", () => {
    const home = tempDir('tracetoon-cursor-home-');
    const repo = tempDir('tracetoon-cursor-repo-');
    process.env.CURSOR_HOME = home;
    transcript(home, cursorProjectName(repo), 'sess-relative');
    transcript(home, cursorProjectName(join(repo, '..', 'elsewhere')), 'sess-other');
    const found = cursorAdapter.discover({ roots: [repo], sinceMs: 0 });
    expect(found.map((r) => r.sessionId)).toEqual(['sess-relative']);
  });
});

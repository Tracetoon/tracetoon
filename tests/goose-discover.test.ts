import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gooseAdapter } from '../src/integrations/goose/trace.ts';

let root: string;
let previous: string | undefined;
const repo = () => join(root, 'work', 'app');

const shell = (command: string) =>
  JSON.stringify([
    {
      type: 'toolRequest',
      toolCall: { status: 'success', value: { name: 'shell', arguments: { command } } },
    },
  ]);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'goose-discover-'));
  previous = process.env.GOOSE_DATA_DIR;
  process.env.GOOSE_DATA_DIR = join(root, 'goose');
  mkdirSync(join(root, 'goose', 'sessions'), { recursive: true });
  const db = new Database(join(root, 'goose', 'sessions', 'sessions.db'));
  db.run('create table sessions (id text, name text, working_dir text, updated_at text)');
  db.run(
    'create table messages (id integer primary key, session_id text, role text, created_timestamp integer, content_json text)',
  );
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const home = join(root, 'home');
  const sessions: [string, string, string][] = [
    ['in-repo', repo(), shell('bun test')],
    // Goose Desktop: started in the home folder, reaches the repo with cmd's cd /d.
    ['from-home', home, shell(`cd /d ${repo()} && git status --short`)],
    ['unrelated', home, shell('dir /b')],
  ];
  for (const [id, dir, content] of sessions) {
    db.run('insert into sessions values (?, ?, ?, ?)', [id, id, dir, now]);
    db.run(
      'insert into messages (session_id, role, created_timestamp, content_json) values (?, ?, ?, ?)',
      [id, 'assistant', Math.floor(Date.now() / 1000), content],
    );
  }
  db.close();
});

afterAll(() => {
  if (previous === undefined) delete process.env.GOOSE_DATA_DIR;
  else process.env.GOOSE_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

test('a session started elsewhere belongs when its messages name the repository', () => {
  const found = gooseAdapter
    .discover({ roots: [repo()], sinceMs: Date.now() - 3600_000 })
    .map((s) => s.sessionId)
    .sort();
  expect(found).toEqual(['from-home', 'in-repo']);
});

test('a needle (a commit SHA) also ties a session to the PR', () => {
  const found = gooseAdapter
    .discover({ roots: [join(root, 'gone')], sinceMs: 0, needles: ['GIT STATUS'] })
    .map((s) => s.sessionId);
  expect(found).toEqual(['from-home']);
});

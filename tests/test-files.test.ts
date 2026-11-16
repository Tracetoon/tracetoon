import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  longestFirst,
  parseShard,
  readTestTimes,
  runTestFiles,
  shardFiles,
  sourceTestFiles,
  workersFor,
  writeTestTimes,
} from '../scripts/test-files.ts';
import { makeRepo, tempDir } from './helpers.ts';

test('worker count follows the machine, leaving CI runners as they were', () => {
  // A CI macOS runner has 3-4 cores; it keeps the one-at-a-time behaviour the
  // pinned Bun's subprocess-heavy suites needed. A developer Mac has cores to
  // spare and runs them in parallel like Linux.
  expect(workersFor('darwin', 3, {})).toBe(1);
  expect(workersFor('darwin', 4, {})).toBe(1);
  expect(workersFor('darwin', 10, {})).toBe(4);
  // Linux and Windows are unchanged.
  expect(workersFor('linux', 4, {})).toBe(4);
  expect(workersFor('linux', 2, {})).toBe(4);
  expect(workersFor('win32', 16, {})).toBe(2);
  // An explicit override wins everywhere, so a flake can be pinned to one.
  expect(workersFor('darwin', 10, { TRACETOON_TEST_WORKERS: '1' })).toBe(1);
  expect(workersFor('linux', 4, { TRACETOON_TEST_WORKERS: '8' })).toBe(8);
  // Nonsense values fall back to the computed count rather than breaking the run.
  expect(workersFor('darwin', 10, { TRACETOON_TEST_WORKERS: '0' })).toBe(4);
  expect(workersFor('darwin', 10, { TRACETOON_TEST_WORKERS: 'many' })).toBe(4);
});

test('each test file gets a new process even when there is only one worker slot', async () => {
  const root = tempDir('tracetoon-test-processes-');
  const changedCwd = tempDir('tracetoon-changed-cwd-');
  writeFileSync(
    join(root, 'a.test.ts'),
    `import {test} from 'bun:test'; test('mutates native process state',()=>{process.env.TRACETOON_POOL_SENTINEL='changed';process.chdir(${JSON.stringify(changedCwd)});});`,
  );
  writeFileSync(
    join(root, 'b.test.ts'),
    `import {test,expect} from 'bun:test'; import {realpathSync} from 'node:fs'; test('starts with independent native state',()=>{expect(process.env.TRACETOON_POOL_SENTINEL).toBeUndefined();expect(realpathSync(process.cwd())).toBe(${JSON.stringify(root)});});`,
  );
  const results = await runTestFiles({
    root,
    files: ['a.test.ts', 'b.test.ts'],
    workers: 1,
    quiet: true,
  });
  expect(results.map((r) => r.code)).toEqual([0, 0]);
});

test('failed test files and empty selections cannot report a passing source run', async () => {
  const root = tempDir('tracetoon-failing-file-');
  writeFileSync(
    join(root, 'failure.test.ts'),
    "import {test,expect} from 'bun:test';test('failure',()=>expect(1).toBe(2));",
  );
  const results = await runTestFiles({ root, files: ['failure.test.ts'], quiet: true });
  expect(results[0]!.code).not.toBe(0);
  await expect(runTestFiles({ root, files: [], quiet: true })).rejects.toThrow(
    'requires files',
  );
});

test('a test file that blocks forever is killed and fails with the output it had', async () => {
  const root = tempDir('tracetoon-hung-file-');
  // A synchronous wait cannot be interrupted by bun's per-test timeout, like a hung spawnSync.
  writeFileSync(
    join(root, 'hang.test.ts'),
    "import {test} from 'bun:test'; test('prints first',()=>{}); test('blocks',()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);});",
  );
  const before = process.env.TRACETOON_TEST_FILE_TIMEOUT_MS;
  process.env.TRACETOON_TEST_FILE_TIMEOUT_MS = '4000';
  try {
    const started = Date.now();
    const results = await runTestFiles({ root, files: ['hang.test.ts'], quiet: true });
    expect(results[0]!.code).toBe(1);
    expect(Date.now() - started).toBeLessThan(60_000);
  } finally {
    if (before === undefined) delete process.env.TRACETOON_TEST_FILE_TIMEOUT_MS;
    else process.env.TRACETOON_TEST_FILE_TIMEOUT_MS = before;
  }
});

test('a file whose bun process does not exit after its summary is killed and judged by the summary', async () => {
  const root = tempDir('tracetoon-late-exit-');
  // The tests finish, then the exit handler blocks: bun printed its summary and never exits.
  const block =
    "process.on('exit',()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);});";
  writeFileSync(
    join(root, 'pass.test.ts'),
    `import {test} from 'bun:test'; ${block} test('passes',()=>{});`,
  );
  writeFileSync(
    join(root, 'fail.test.ts'),
    `import {test,expect} from 'bun:test'; ${block} test('fails',()=>expect(1).toBe(2));`,
  );
  const before = process.env.TRACETOON_TEST_EXIT_GRACE_MS;
  process.env.TRACETOON_TEST_EXIT_GRACE_MS = '1500';
  try {
    const started = Date.now();
    const results = await runTestFiles({
      root,
      files: ['pass.test.ts', 'fail.test.ts'],
      workers: 2,
      quiet: true,
    });
    expect(results.map((r) => [r.file, r.code])).toEqual([
      ['pass.test.ts', 0],
      ['fail.test.ts', 1],
    ]);
    expect(Date.now() - started).toBeLessThan(60_000);
  } finally {
    if (before === undefined) delete process.env.TRACETOON_TEST_EXIT_GRACE_MS;
    else process.env.TRACETOON_TEST_EXIT_GRACE_MS = before;
  }
});

test('source discovery includes tracked and new tests throughout the repo, excluding private trails', () => {
  const repo = makeRepo();
  repo.commit('src/inside.test.ts', '// tracked fixture\n', 'Add source test');
  writeFileSync(join(repo.root, 'new.spec.ts'), '// new fixture\n');
  mkdirSync(join(repo.root, '.showtail'));
  writeFileSync(join(repo.root, '.showtail/private.test.ts'), '// private fixture\n');
  mkdirSync(join(repo.root, 'node_modules'));
  writeFileSync(
    join(repo.root, 'node_modules/vendor.test.ts'),
    '// dependency fixture\n',
  );
  writeFileSync(join(repo.root, '.gitignore'), 'ignored.test.ts\n');
  writeFileSync(join(repo.root, 'ignored.test.ts'), '// ignored fixture\n');
  expect(sourceTestFiles(repo.root)).toEqual(['new.spec.ts', 'src/inside.test.ts']);
});

test('slowest files start first: measured times, then size for unmeasured files', () => {
  const root = tempDir('tracetoon-longest-first-');
  writeFileSync(join(root, 'a.test.ts'), 'x'.repeat(10));
  writeFileSync(join(root, 'b.test.ts'), 'x'.repeat(5_000));
  writeFileSync(join(root, 'c.test.ts'), 'x'.repeat(10));
  writeFileSync(join(root, 'new.test.ts'), 'x'.repeat(2_000));
  const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'new.test.ts'];
  // Alphabetical order would start the slowest file (c) last.
  expect(
    longestFirst(root, files, {
      'a.test.ts': 100,
      'b.test.ts': 900,
      'c.test.ts': 90_000,
    }),
  ).toEqual(['c.test.ts', 'new.test.ts', 'b.test.ts', 'a.test.ts']);
  // With no history, size decides and ties keep a stable order.
  expect(longestFirst(root, files, {})).toEqual([
    'b.test.ts',
    'new.test.ts',
    'a.test.ts',
    'c.test.ts',
  ]);
});

test('runs report durations; only passing runs update the timing history', async () => {
  const root = tempDir('tracetoon-test-times-');
  writeFileSync(
    join(root, 'ok.test.ts'),
    "import {test} from 'bun:test';test('ok',()=>{});",
  );
  writeFileSync(
    join(root, 'bad.test.ts'),
    "import {test,expect} from 'bun:test';test('bad',()=>expect(1).toBe(2));",
  );
  expect(readTestTimes(root)).toEqual({});
  writeTestTimes(root, [{ file: 'bad.test.ts', code: 0, ms: 4_000 }]);
  const results = await runTestFiles({
    root,
    files: ['ok.test.ts', 'bad.test.ts'],
    workers: 1,
    quiet: true,
  });
  expect(results.map((r) => [r.file, r.code === 0])).toEqual([
    ['ok.test.ts', true],
    ['bad.test.ts', false],
  ]);
  expect(results.every((r) => Number.isInteger(r.ms) && r.ms > 0)).toBe(true);
  writeTestTimes(root, results);
  const times = readTestTimes(root);
  expect(times['ok.test.ts']).toBe(results[0]!.ms);
  // The failed run keeps the earlier, representative time.
  expect(times['bad.test.ts']).toBe(4_000);
});

test('a checkout without history orders by the committed baseline; local history wins', () => {
  const root = tempDir('tracetoon-baseline-times-');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(
    join(root, 'scripts', 'test-times.baseline.json'),
    JSON.stringify({ 'slow.test.ts': 90_000, 'quick.test.ts': 50 }),
  );
  expect(readTestTimes(root)).toEqual({ 'slow.test.ts': 90_000, 'quick.test.ts': 50 });
  writeTestTimes(root, [{ file: 'quick.test.ts', code: 0, ms: 120_000 }]);
  expect(readTestTimes(root)).toEqual({
    'slow.test.ts': 90_000,
    'quick.test.ts': 120_000,
  });
  // Only measured times are written back; the baseline stays a separate fallback.
  expect(
    JSON.parse(
      readFileSync(join(root, 'node_modules/.cache/tracetoon-test-times.json'), 'utf8'),
    ),
  ).toEqual({ 'quick.test.ts': 120_000 });
});

test('shards cover every file exactly once, agree on the split and balance the load', () => {
  const root = tempDir('tracetoon-shards-');
  const times: Record<string, number> = {
    'a.test.ts': 220,
    'b.test.ts': 180,
    'c.test.ts': 160,
    'd.test.ts': 120,
    'e.test.ts': 110,
    'f.test.ts': 60,
    'g.test.ts': 50,
    'h.test.ts': 40,
  };
  const files = [...Object.keys(times), 'unmeasured.test.ts'].reverse();
  writeFileSync(join(root, 'unmeasured.test.ts'), 'x'.repeat(30));
  const shards = [1, 2, 3].map((index) =>
    shardFiles(root, files, times, { index, count: 3 }),
  );
  expect(shards.flat().sort()).toEqual([...files].sort());
  // Each machine computes the split on its own, so it must not depend on input order.
  expect(shardFiles(root, [...files].sort(), times, { index: 2, count: 3 })).toEqual(
    shards[1]!,
  );
  const cost = (s: string[]) => s.reduce((t, f) => t + (times[f] ?? 30), 0);
  const loads = shards.map(cost);
  // Greedy longest-first: no shard exceeds an even share by more than the longest file.
  expect(Math.max(...loads)).toBeLessThanOrEqual(cost(files) / 3 + 220);
  // 220+60+50 | 180+110+30 | 160+120+40
  expect(loads).toEqual([330, 320, 320]);
  // Within a shard the slowest file still starts first.
  for (const s of shards) expect(s).toEqual([...s].sort((x, y) => cost([y]) - cost([x])));
  // One shard is the whole list in longest-first order.
  expect(shardFiles(root, files, times, { index: 1, count: 1 })).toEqual(
    longestFirst(root, files, times),
  );
});

test('the shard setting is i/n or unset; anything else stops the run', () => {
  expect(parseShard(undefined)).toBeUndefined();
  expect(parseShard('')).toBeUndefined();
  expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });
  expect(parseShard(' 1 / 1 ')).toEqual({ index: 1, count: 1 });
  for (const bad of ['0/3', '4/3', '3', 'a/b', '1/0'])
    expect(() => parseShard(bad)).toThrow('TRACETOON_TEST_SHARD');
});

import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beginTask } from '../src/workflow/state.ts';
import {
  compactCheckText,
  executeCheckLive,
  failingTests,
  receipts,
} from '../src/workflow/checks.ts';
import { makeRepo, tempDir } from './helpers.ts';

test('CLI streams check progress with --progress while the receipt and lock still indicate running', async () => {
  const repo = makeRepo(),
    { run } = beginTask(repo.root);
  const release = join(tempDir(), 'release');
  const cli = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
  const command = `console.log('CHECK_PROGRESS_VISIBLE'); const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(release)})){clearInterval(timer);console.log('1 pass');}},20);`;
  const proc = Bun.spawn(
    [
      ...(process.env.TRACETOON_TEST_BINARY
        ? [process.env.TRACETOON_TEST_BINARY]
        : [process.execPath, cli]),
      '--json',
      'check',
      '--run',
      run.id,
      '--name',
      'progress',
      '--progress',
      '--',
      process.execPath,
      '-e',
      command,
    ],
    {
      cwd: repo.root,
      env: process.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const visible = Promise.withResolvers<void>();
  let stderr = '';
  const reading = (async () => {
    for await (const bytes of proc.stderr) {
      stderr += new TextDecoder().decode(bytes);
      if (stderr.includes('CHECK_PROGRESS_VISIBLE')) visible.resolve();
    }
  })();
  const stdout = new Response(proc.stdout).text();
  const timer = setTimeout(
    () => visible.reject(new Error('No progress before the check finished.')),
    15000,
  );
  try {
    await visible.promise;
    expect(proc.exitCode).toBeNull();
    expect(receipts(run)[0]?.outcome).toBe('running');
    expect(existsSync(join(run.dir, 'checks.lock'))).toBe(true);
    writeFileSync(release, 'finish');
    expect(await proc.exited).toBe(0);
    await reading;
    expect(JSON.parse(await stdout)).toMatchObject({
      outcome: 'passed',
      summary: ['1 pass'],
    });
    expect(stderr).toContain('1 pass');
    expect(existsSync(join(run.dir, 'checks.lock'))).toBe(false);
    const saved = JSON.parse(readFileSync(join(run.dir, 'checks.json'), 'utf8'))[0];
    expect(saved).not.toHaveProperty('stdout');
    expect(saved).not.toHaveProperty('stderr');
  } finally {
    clearTimeout(timer);
    writeFileSync(release, 'finish');
    if (proc.exitCode === null) proc.kill();
  }
}, 25000);

test('CLI check is quiet until done: no stderr, one summary on stdout, live output in running.log', async () => {
  const repo = makeRepo(),
    { run } = beginTask(repo.root);
  const release = join(tempDir(), 'release');
  const live = join(run.dir, 'check-logs', 'running.log');
  const cli = process.env.TRACETOON_TEST_CLI ?? resolve(import.meta.dir, '../src/cli.ts');
  const command = `console.log('QUIET_LINE'); const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(release)})){clearInterval(timer);console.log('1 pass');}},20);`;
  const env = { ...process.env };
  delete env.TRACETOON_CHECK_PROGRESS;
  const proc = Bun.spawn(
    [
      ...(process.env.TRACETOON_TEST_BINARY
        ? [process.env.TRACETOON_TEST_BINARY]
        : [process.execPath, cli]),
      'check',
      '--run',
      run.id,
      '--name',
      'quiet',
      '--',
      process.execPath,
      '-e',
      command,
    ],
    { cwd: repo.root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  try {
    const until = Date.now() + 15000;
    while (
      !(existsSync(live) && readFileSync(live, 'utf8').includes('QUIET_LINE')) &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(live, 'utf8')).toContain('QUIET_LINE');
    writeFileSync(release, 'finish');
    expect(await proc.exited).toBe(0);
    expect(await stderr).toBe('');
    const out = await stdout;
    expect(out).toContain('quiet: passed');
    expect(out).not.toContain('QUIET_LINE');
    expect(existsSync(live)).toBe(false);
  } finally {
    writeFileSync(release, 'finish');
    if (proc.exitCode === null) proc.kill();
  }
}, 25000);

test('live checks preserve failure exits and reuse only a completed matching pass', async () => {
  const repo = makeRepo(),
    { run } = beginTask(repo.root);
  const failed = await executeCheckLive(repo.root, run, {
    name: 'failure',
    command: [process.execPath, '-e', 'console.error("1 fail");process.exit(7)'],
  });
  expect(failed).toMatchObject({ outcome: 'failed', exitCode: 7, summary: ['1 fail'] });
  const options = {
    name: 'pass',
    command: [process.execPath, '-e', 'console.log("1 pass")'],
  };
  expect((await executeCheckLive(repo.root, run, options)).outcome).toBe('passed');
  expect((await executeCheckLive(repo.root, run, options)).reused).toBe(true);
  const missing = await executeCheckLive(repo.root, run, {
    name: 'missing',
    command: ['missing-tracetoon-validation-command'],
  });
  expect(missing.outcome).toBe('failed');
  expect(missing.reason).toBeTruthy();
  expect(existsSync(join(run.dir, 'checks.lock'))).toBe(false);
}, 25000);

test('a check stops at its timeout, saves its log and names failing tests', async () => {
  const repo = makeRepo(),
    { run } = beginTask(repo.root);
  const slow = await executeCheckLive(repo.root, run, {
    name: 'slow suite',
    command: [
      process.execPath,
      '-e',
      'console.log("start"); setTimeout(() => {}, 60000)',
    ],
    timeoutMs: 300,
  });
  expect(slow.outcome).toBe('failed');
  expect(slow.timedOut).toBe(true);
  expect(slow.reason).toBe('Stopped at the 1 s limit; incomplete, not a failure.');
  expect(slow.summary).toEqual([]);
  const failing = await executeCheckLive(repo.root, run, {
    name: 'unit',
    command: [
      process.execPath,
      '-e',
      'console.log("(pass) cache > hits");console.log("(fail) cache > evicts oldest [1.20ms]");console.log("1 pass\\n1 fail");process.exit(1)',
    ],
  });
  expect(failing.failing).toEqual(['cache > evicts oldest']);
  expect(readFileSync(failing.log!, 'utf8')).toContain('(pass) cache > hits');
  const text = compactCheckText(failing);
  expect(text.split('\n').length).toBeLessThanOrEqual(20);
  expect(text).toContain('  - cache > evicts oldest');
  expect(text).toContain(`full log: ${failing.log}`);
  expect(
    failingTests('--- FAIL: TestParse (0.00s)\nFAILED tests/test_a.py::test_b'),
  ).toEqual(['TestParse', 'tests/test_a.py::test_b']);
}, 25000);

test("prepare's next step carries the drafting rules and the foreground-check rule", async () => {
  const { graphNext } = await import('../src/commands/digest.ts');
  const next = graphNext('r1');
  expect(next).toContain('Drafting rules');
  expect(next).toContain('"Previously …"');
  expect(next).toContain('in the FOREGROUND');
  expect(next).toContain('Never start it in the background, poll it');
  expect(next).toContain(
    'Always render and review before ending the turn and before any optional waiting',
  );
  expect(next).not.toContain('a later request in the session asked');
});

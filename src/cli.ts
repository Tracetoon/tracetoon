#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
import { argvWantsJson, buildProgram } from './program.ts';
import { errorEnvelope, exitCodeOf } from './commands/output.ts';
import { findRun } from './run.ts';
import { repository } from './workflow/state.ts';
import { recordTiming } from './workflow/publication.ts';
import { saveProfile } from './util/profile.ts';
import { claudeCodeHint } from './util/claudeHint.ts';
import { withGitAnswers } from './util/exec.ts';
import { isShim, shimMain } from './util/shShim.ts';
import { gitUsrBin, windowsReg } from './hook/windowsSh.ts';
import { join } from 'node:path';
import { acquireRunLock, captureOutput, lockTarget, releaseRunLock } from './workflow/runLock.ts';

// Started as sh.exe: Tracetoon's sh shim for Goose hooks (src/util/shShim.ts).
if (isShim()) {
  const code = shimMain(process.argv.slice(2), () => {
    const bin = gitUsrBin(windowsReg, process.env);
    return bin ? join(bin, 'sh.exe') : undefined;
  });
  await new Promise<void>((done) => process.stdout.write('', () => done()));
  process.exit(code);
}

const cwd = process.cwd();

// Claude Code's plugin-install hint (off until Tracetoon is in an official marketplace).
// stderr only, on its own line, so --json stdout is never touched.
const hint = claudeCodeHint(process.argv.slice(2));
if (hint) process.stderr.write(hint);

const { program, state } = buildProgram(cwd);

// A test harness may name a file to receive the exit code just before exit (see
// tests/spawn-guard.ts). Cleared now, so nothing this process starts inherits it.
const exitFile = process.env.TRACETOON_EXIT_FILE;
delete process.env.TRACETOON_EXIT_FILE;

/** Commander's own outcomes that are not usage errors. */
const COMMANDER_EXITS = [
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
];

// One mutating command per run folder at a time (see workflow/runLock.ts).
const lockFor = lockTarget(cwd, process.argv);
let lockStart: string | undefined;
let captured: (() => { stdout: string; stderr: string }) | undefined;
if (lockFor) {
  const got = await acquireRunLock(lockFor, (t) => process.stderr.write(t));
  if (got.replay) {
    // The same command already ran to the end while this one waited: its result.
    process.stdout.write(got.replay.stdout);
    process.stderr.write(got.replay.stderr);
    await new Promise<void>((done) => process.stdout.write('', () => done()));
    await new Promise<void>((done) => process.stderr.write('', () => done()));
    if (exitFile)
      try {
        writeFileSync(exitFile, String(got.replay.exitCode));
      } catch {
        // only a test aid
      }
    process.exit(got.replay.exitCode);
  }
  lockStart = got.startedAt;
  captured = captureOutput();
}

try {
  // One command: repeated read-only git questions are answered once (see withGitAnswers).
  await withGitAnswers(() => program.parseAsync(process.argv));
} catch (e) {
  const err = e as Error & { exitCode?: number; code?: unknown };
  const json = !!program.opts().json || argvWantsJson(process.argv);
  if (typeof err.code === 'string' && err.code.startsWith('commander.')) {
    if (COMMANDER_EXITS.includes(err.code))
      // --help, --version, or a command group run alone (which prints its help).
      process.exitCode = err.exitCode ?? 0;
    else {
      // A usage error. Commander has already printed it, unless --json asked for JSON.
      if (json)
        process.stdout.write(
          JSON.stringify({
            ...errorEnvelope(err),
            error: err.message.replace(/^error:\s*/, ''),
            errorCode: 'USAGE',
            fix: 'tracetoon commands --json',
          }) + '\n',
        );
      // Hosts read a hook's exit 2 as "block the tool call", so hook commands keep 1.
      const first = process.argv.slice(2).find((a) => !a.startsWith('-'));
      process.exitCode = first === 'hook' ? 1 : 2;
    }
  } else {
    if (json) process.stdout.write(JSON.stringify(errorEnvelope(err)) + '\n');
    else process.stderr.write(`tracetoon: ${err.message}\n`);
    process.exitCode = exitCodeOf(err);
  }
} finally {
  if (lockFor && lockStart && captured)
    releaseRunLock(lockFor, lockStart, {
      ...captured(),
      exitCode: Number(process.exitCode ?? 0),
    });
  const timed = state.timedAction;
  if (
    timed &&
    [
      'digest',
      'prepare',
      'context',
      'expand',
      'query',
      'source',
      'render',
      'publish',
      'art',
      'check',
    ].includes(timed.name)
  ) {
    try {
      const run = findRun(repository(cwd).gitDir, timed.run);
      recordTiming(run, timed.name, performance.now() - timed.started);
      saveProfile(run, timed.name);
    } catch {
      /* timing must not break the workflow */
    }
  }
}

// Leave explicitly once output is flushed. On Windows a finished command's process has been
// seen to keep running after it printed its whole result (CI tests waited the full timeout
// for `review import`), so a natural exit cannot be relied on.
await new Promise<void>((done) => process.stdout.write('', () => done()));
await new Promise<void>((done) => process.stderr.write('', () => done()));
if (exitFile)
  try {
    writeFileSync(exitFile, String(process.exitCode ?? 0));
  } catch {
    // only a test aid
  }
process.exit(process.exitCode ?? 0);

import { currentSessionId } from '../integrations/registry.ts';
import { defaultBase } from '../git/pr.ts';
import { findRun } from '../run.ts';
import { beginTask, readTask, repository, saveTask } from '../workflow/state.ts';
import {
  checkTimeoutMs,
  compactCheckText,
  executeCheckLive,
  receipts,
} from '../workflow/checks.ts';
import { emit, UserError, type OutOpts } from './output.ts';
import { readHost, rememberRepository } from '../workflow/hostSession.ts';

interface TaskOpts extends OutOpts {
  run?: string;
  base?: string;
  session?: string;
  transcript?: string;
  reason?: string;
  checks?: string;
  noChecks?: string;
}
export function taskCmd(
  cwd: string,
  action: 'begin' | 'complete' | 'defer' | 'block',
  opts: TaskOpts,
) {
  const session = opts.session ?? currentSessionId();
  const observed = session ? readHost(session) : undefined;
  const info = beginTask(cwd, {
    ...opts,
    session,
    transcript: opts.transcript ?? observed?.transcript,
    // complete/defer/block keep the task's branch; only begin adopts another one.
    adopt: action === 'begin',
  });
  const { run, task } = info;
  if (action === 'begin' && ['deferred', 'blocked'].includes(task.state)) {
    task.recoveryGeneration = (task.recoveryGeneration ?? 0) + 1;
    task.state = 'working';
    task.reason = undefined;
    saveTask(run, task);
  }
  if (task.session)
    rememberRepository(task.session, info.root, task.baseline, task.transcript);
  if (action !== 'begin') {
    if ((action === 'defer' || action === 'block') && !opts.reason?.trim())
      throw new UserError('Record a reason for unfinished or blocked work.');
    task.state =
      action === 'complete' ? 'preparing' : action === 'block' ? 'blocked' : 'deferred';
    task.reason = opts.reason;
    if (opts.checks !== undefined) {
      task.checks = opts.checks
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      task.noChecksReason = undefined;
    } else if (!task.checks?.length && receipts(run).length)
      task.checks = receipts(run).map((c) => c.name);
    if (opts.noChecks) {
      task.noChecksReason = opts.noChecks;
      task.checks = [];
    }
    saveTask(run, task);
  }
  const next =
    task.state === 'preparing'
      ? `${task.prRequestedAt && info.branch === task.base ? `Create a local feature branch first (PR head and base cannot both be ${task.base}), then adopt it with task begin --run ${run.id}. ` : ''}When the user wants a PR, use the tracetoon skill with digest --run ${run.id}, context, research, drafting, comic and independent review, then tracetoon publish --run ${run.id}.`
      : `Reuse this run with --run ${run.id}. Task bookkeeping and check receipts are optional.`;
  emit(
    opts,
    { run: run.id, runDir: run.dir, state: task.state, nextAction: next },
    () => `Task ${run.id}: ${task.state}. ${next}`,
  );
}

/**
 * Runs `attempt`; while another `tracetoon check` of this run holds the
 * checks lock, waits for it in the foreground (one notice on stderr) and
 * tries again, up to `limitMs` plus a minute. A check moved to the
 * background is waited on by running the same command again, never polled.
 */
export async function waitingForOtherCheck<T>(
  attempt: () => Promise<T>,
  limitMs: number,
  pollMs = 2_000,
): Promise<T> {
  const until = Date.now() + limitMs + 60_000;
  let told = false;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (
        !/already running/.test(String((error as Error)?.message)) ||
        Date.now() > until
      )
        throw error;
      if (!told)
        process.stderr.write(
          'Another check of this run is still running; waiting for it here in the foreground.\n',
        );
      told = true;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

export async function checkCmd(
  cwd: string,
  command: string[],
  opts: OutOpts & {
    run: string;
    name?: string;
    cwd?: string;
    skip?: string;
    force?: boolean;
    input?: string[];
    timeout?: string;
    progress?: boolean;
  },
) {
  const repo = repository(cwd);
  const run = findRun(repo.gitDir, opts.run);
  const task = readTask(run);
  if (task && (task.branch !== repo.branch || task.root !== repo.root))
    throw new UserError('Run checks in this task worktree and branch.');
  // Quiet until done (one summary at the end) unless --progress or a terminal:
  // an agent's exec tool returns at its own yield time, and streamed lines
  // only cost tokens on every poll. The live output is in check-logs/running.log.
  const progress = opts.progress ?? (!!process.stderr.isTTY || process.env.TRACETOON_CHECK_PROGRESS === '1');
  const attempt = () =>
    executeCheckLive(repo.root, run, {
      ...opts,
      progress,
      name: opts.name ?? command.join(' '),
      command,
      timeoutMs: checkTimeoutMs(opts.timeout),
      onStart: (receipt) => {
        if (progress && receipt.outcome === 'running' && !opts.skip)
          process.stderr.write(
            `${receipt.name}: running in the foreground; wait for it (stops after ${Math.round(checkTimeoutMs(opts.timeout) / 60_000)} min). The first output lines follow on stderr, the full log is saved in the run folder.\n`,
          );
      },
    });
  const receipt = await waitingForOtherCheck(attempt, checkTimeoutMs(opts.timeout));
  // A compact summary (outcome, counts, failing tests, the log path), not the output.
  emit(opts, receipt, () => compactCheckText(receipt));
  // A timeout is incomplete, not a failure: its own exit code (as timeout(1)).
  if (receipt.timedOut) process.exitCode = 124;
  else if (receipt.outcome === 'failed')
    process.exitCode = receipt.exitCode && receipt.exitCode > 0 ? receipt.exitCode : 1;
}

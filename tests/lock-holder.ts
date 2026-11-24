/**
 * Holds a run's lock for the run-lock tests, as a real holder would:
 * `bun tests/lock-holder.ts <runDir> <command> <keyJson> <holdMs> [stdout]`.
 * After holdMs it records `stdout` as its result and releases the lock.
 */
import { basename } from 'node:path';
import { acquireRunLock, releaseRunLock } from '../src/workflow/runLock.ts';

const [dir, command, key, holdMs, stdout] = process.argv.slice(2);
const t = { run: { id: basename(dir!), dir: dir! }, command: command!, key: key! };
const { startedAt } = await acquireRunLock(t, () => {});
await Bun.sleep(Number(holdMs));
releaseRunLock(t, startedAt, { stdout: stdout ?? '', stderr: '', exitCode: 0 });
process.exit(0);

/**
 * A run's scratch folder: `<state dir>/runs/<id>/` (see `stateDir`). Git never
 * tracks it and each run is self-contained. Runs with unfinished tasks are kept
 * until publication; other runs are disposable scratch.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureStateDir } from './util/stateDir.ts';
import { count } from './util/profile.ts';
import { codedError } from './commands/output.ts';

export interface Run {
  id: string;
  dir: string;
}

/** Legacy scratch runs have no owner; registered runs must stay in their worktree. */
export function assertRunOwner(run: Run, root: string, branch: string): void {
  const file = join(run.dir, 'task.json');
  if (!existsSync(file)) return;
  const task = JSON.parse(readFileSync(file, 'utf8'));
  if (
    (task.root && resolve(task.root) !== resolve(root)) ||
    (task.branch && task.branch !== branch)
  )
    throw new Error(
      `Run ${run.id} belongs to another worktree or branch. Select its checkout or use another --run.`,
    );
}

export { ensureStateDir, stateDir, STATE_FOLDER } from './util/stateDir.ts';

function runsDir(state: string): string {
  return join(state, 'runs');
}

export function newRun(state: string): Run {
  const id = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
    .replace('T', '-');
  ensureStateDir(state);
  let dir = join(runsDir(state), id);
  let n = 1;
  while (existsSync(dir)) dir = join(runsDir(state), `${id}-${n++}`);
  mkdirSync(dir, { recursive: true });
  const name = dir.split(/[\\/]/).pop()!;
  writeFileSync(join(runsDir(state), 'latest'), name, 'utf8');
  pruneRuns(state, name);
  return { id: name, dir };
}

/** How many scratch runs to keep in addition to unfinished tasks. */
export const KEEP_RUNS = 20;

/** Delete all but the newest run folders (never `keep`). */
export function pruneRuns(state: string, keep?: string): void {
  const base = runsDir(state);
  const runs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{6}(-\d+)?$/.test(d.name))
    .map((d) => d.name)
    .sort();
  const pending = new Set<string>();
  // A paired evaluation is durable evidence, not disposable task scratch.
  try {
    const evaluation = JSON.parse(
      readFileSync(join(state, 'comic-gallery', 'manifest.json'), 'utf8'),
    );
    if (evaluation.v === 1 && Array.isArray(evaluation.cases))
      for (const item of evaluation.cases)
        for (const id of [item?.baseline, item?.candidate])
          if (typeof id === 'string' && /^\d{8}-\d{6}(-\d+)?$/.test(id)) pending.add(id);
  } catch {
    /* No valid local evaluation manifest. */
  }
  for (const name of runs) {
    try {
      const task = JSON.parse(readFileSync(join(base, name, 'task.json'), 'utf8'));
      if (task.v === 1 && task.state !== 'published') pending.add(name);
    } catch {
      /* ordinary scratch run */
    }
  }
  const scratch = runs.filter((name) => !pending.has(name));
  for (const name of scratch.slice(0, Math.max(0, scratch.length - KEEP_RUNS)))
    if (name !== keep) rmSync(join(base, name), { recursive: true, force: true });
}

/** The named run, or the latest one. */
export function findRun(state: string, id?: string): Run {
  const base = runsDir(state);
  let name = id;
  if (!name) {
    const latest = join(base, 'latest');
    if (existsSync(latest)) name = readFileSync(latest, 'utf8').trim();
    else {
      const all = existsSync(base)
        ? readdirSync(base)
            .filter((f) => f !== 'latest')
            .sort()
        : [];
      name = all[all.length - 1];
    }
  }
  if (!name || !existsSync(join(base, name))) {
    throw codedError(
      'RUN_NOT_FOUND',
      'No Tracetoon run found. Run `tracetoon digest` first.',
    );
  }
  if (!/^\d{8}-\d{6}(-\d+)?$/.test(name))
    throw codedError('RUN_NOT_FOUND', 'Invalid Tracetoon run id.');
  return { id: name, dir: join(base, name) };
}

export function writeJson(run: Run, file: string, data: unknown): string {
  const p = join(run.dir, file);
  const text = JSON.stringify(data, null, 2) + '\n';
  if (!existsSync(p) || readFileSync(p, 'utf8') !== text) {
    writeFileSync(p, text, 'utf8');
    count('artifact.writes');
  } else count('artifact.writesReused');
  return p;
}

export function readJson<T>(run: Run, file: string): T | undefined {
  const p = join(run.dir, file);
  if (!existsSync(p)) return undefined;
  const text = readFileSync(p, 'utf8');
  if (file.startsWith('digest')) {
    count('evidence.reads');
    count('evidence.bytes', Buffer.byteLength(text));
  }
  return JSON.parse(text) as T;
}

export function readText(run: Run, file: string): string | undefined {
  const p = join(run.dir, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}

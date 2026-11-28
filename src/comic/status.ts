/** `comic-status.json` in a run: why the last `comic art` drew nothing, for publish to say so. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '../run.ts';

/**
 * Why this PR has no comic, for render and publish to say so: no image route,
 * drawing failed, or a recorded skip (`tracetoon comic skip`, or MCP, which
 * can't draw). Without one, an expected comic that is missing stops publish.
 */
export interface ComicStatus {
  state: 'no-route' | 'failed' | 'skipped';
  /** For a skip: who decided (the user, the agent, or a host that can't draw). */
  by?: 'user' | 'agent' | 'mcp';
  detail: string;
  /**
   * The skip is `tracetoon comic run`'s own outcome (setup pending, drawing
   * failed), not a decision: the next `comic run` tries again, because what
   * stopped it (a sign-in, an approval, a dropped connection) may be fixed.
   * A skip someone chose (`comic skip`) never has it and stays final.
   */
  auto?: true;
  at: string;
}

const STATUS_FILE = 'comic-status.json';

export function writeComicStatus(
  run: Run,
  status: Omit<ComicStatus, 'at'> & { at?: string },
): void {
  const record: ComicStatus = {
    state: status.state,
    ...(status.by ? { by: status.by } : {}),
    ...(status.auto ? { auto: true as const } : {}),
    detail: status.detail.replace(/\s+/g, ' ').trim().slice(0, 120),
    at: status.at ?? new Date().toISOString(),
  };
  writeFileSync(
    join(run.dir, STATUS_FILE),
    JSON.stringify(record, null, 2) + '\n',
    'utf8',
  );
}

export function readComicStatus(run: Run): ComicStatus | undefined {
  try {
    const s = JSON.parse(readFileSync(join(run.dir, STATUS_FILE), 'utf8')) as ComicStatus;
    return s && ['no-route', 'failed', 'skipped'].includes(s.state) ? s : undefined;
  } catch {
    return undefined;
  }
}

export function clearComicStatus(run: Run): void {
  rmSync(join(run.dir, STATUS_FILE), { force: true });
}

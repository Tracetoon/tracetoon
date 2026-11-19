/**
 * The one hook a host plugin runs: `tracetoon hook plugin --agent <id> --event <E>`.
 * Plugins start the runtime through a pinned `npx`, which costs a few hundred
 * milliseconds, so the PR check and the observation share one process here
 * instead of the two separate commands a user-level install registers.
 */
import { dirname, join } from 'node:path';
import { decide, readStdin, writeAnswer, type HookAgent } from './prHook.ts';
import { lifecycle, type LifecycleEvent } from './lifecycle.ts';
import type { Integration } from '../integrations/types.ts';
import { writeLocal } from '../util/localJson.ts';
import { userConfigPath } from '../config.ts';

/** The answer for one plugin hook call, or undefined to allow and stay quiet. */
export function pluginAnswer(
  agent: HookAgent,
  event: LifecycleEvent,
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
  onDeny?: (host: Integration) => void,
): string | undefined {
  // The task-aware answer (it names the run to publish with) comes first; the
  // plain PR check still blocks when observation has nothing to say.
  const observed = lifecycle(agent, event, payload, env, onDeny);
  if (observed || event !== 'PreToolUse') return observed;
  return decide(agent, payload, env, onDeny);
}

export async function runPluginHook(agent: HookAgent, event: LifecycleEvent) {
  try {
    const raw = await readStdin();
    let blockedFor: Integration | undefined;
    const answer = pluginAnswer(
      agent,
      event,
      raw ? JSON.parse(raw) : {},
      process.env,
      (h) => (blockedFor = h),
    );
    if (answer) writeAnswer(answer, blockedFor);
  } catch (e) {
    // Never in the way of normal work; doctor shows the last error.
    try {
      writeLocal(join(dirname(userConfigPath()), 'last-hook-error.json'), {
        agent,
        event,
        via: 'plugin',
        at: new Date().toISOString(),
        error: (e as Error).message,
      });
    } catch {
      /* best effort */
    }
  }
}

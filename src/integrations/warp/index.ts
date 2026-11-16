/**
 * Warp's agent: Tracetoon reads the prompts and the commands the agent ran
 * from Warp's local database (./trace.ts). Warp has no hook before its agent's
 * tools, so PR commands aren't redirected; Warp reads skills from
 * ~/.agents/skills.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { onPath } from '../../util/onPath.ts';
import type { Env, Integration } from '../types.ts';
import { warpAdapter, warpDbPath } from './trace.ts';

const present = (h: string, env: Env) =>
  existsSync(dirname(warpDbPath(env, h))) || !!onPath('warp', env);

export const integration: Integration = {
  id: 'warp',
  label: 'Warp',
  status: 'partial',
  variants: 'Warp agent',
  limits: [
    "Warp keeps its agent's replies and file edits on its servers; Tracetoon reads the prompts and the commands the agent ran, from Warp's local database.",
    "Warp has no hook before its agent's tools, so a PR command run by Warp's agent isn't redirected; the agent can still use the Tracetoon skill.",
  ],
  traces: [warpAdapter],
  skill: (h, env) => ({
    present: present(h, env),
    dir: join(h, '.agents', 'skills', 'tracetoon'),
  }),
};

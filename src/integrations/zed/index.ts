/**
 * Zed's own agent: Tracetoon reads its threads (./trace.ts). Zed has no hook
 * that runs before its agent's tools, so PR commands aren't redirected; the
 * agent finds the Tracetoon skill in ~/.agents/skills. Agents Zed runs over ACP
 * (Claude Code, Codex, Copilot CLI) are covered by their own integrations.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { onPath } from '../../util/onPath.ts';
import type { Env, Integration } from '../types.ts';
import { zedAdapter, zedDataDir } from './trace.ts';

const present = (h: string, env: Env) =>
  existsSync(zedDataDir(env, h)) || !!onPath('zed', env);

export const integration: Integration = {
  id: 'zed',
  label: 'Zed',
  status: 'partial',
  supportTier: 'community',
  variants: 'Zed Agent',
  limits: [
    "Zed has no hook before its agent's tools, so a PR command run by the Zed Agent isn't redirected; the agent can still use the Tracetoon skill.",
    'Claude Code, Codex and Copilot CLI run inside Zed are covered by their own integrations.',
  ],
  traces: [zedAdapter],
  skill: (h, env) => ({
    present: present(h, env),
    dir: join(h, '.agents', 'skills', 'tracetoon'),
  }),
};

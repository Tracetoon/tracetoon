/**
 * Devin CLI (Cognition), and Devin Desktop (formerly Windsurf), whose agent
 * runs the same engine and writes the same sessions.db in Devin's data
 * folder. Devin imports the hooks other agents configure
 * (Claude Code's settings among them), so Tracetoon's Claude Code hook already
 * routes PR creation inside Devin; this integration adds Devin's session logs.
 * Skills are read from ~/.agents/skills (shared with Codex).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { onPath } from '../../util/onPath.ts';
import type { Integration } from '../types.ts';
import { devinAdapter, devinDataDir } from './trace.ts';

export const integration: Integration = {
  id: 'devin',
  label: 'Devin',
  status: 'supported',
  variants: 'CLI and Devin Desktop, formerly Windsurf',
  limits: [
    'Devin Desktop runs the Devin CLI engine and keeps its sessions in the same database, so it is read the same way; it has not yet been tested end to end.',
  ],
  hookVia: 'claude',
  traces: [devinAdapter],
  skill: (h, env) => ({
    present: existsSync(devinDataDir(env)) || !!onPath('devin', env),
    dir: join(h, '.agents', 'skills', 'tracetoon'),
  }),
};

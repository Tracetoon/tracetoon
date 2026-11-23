/**
 * One fresh, non-interactive agent session started by Tracetoon itself, the
 * way `tracetoon review run` starts reviewers: a print-mode Claude Code
 * process under Claude Code (the session's own binary), `codex exec`
 * elsewhere (TRACETOON_REVIEW_RUNNER overrides). The session id and the model
 * it actually ran on come from the process itself (Claude Code's modelUsage,
 * Codex's rollout), never from the agent's own words.
 *
 * Used by `tracetoon comic run` for the comic author and the quality-loop
 * judges. The agent can read files (judges must see images) but never writes
 * or runs anything: it replies, and Tracetoon writes the files.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexBin, runCli } from '../comic/providers.ts';
import {
  claudeBin,
  claudeChildEnv,
  claudeResult,
  lastAgentMessage,
  parseEvents,
  reviewRunner,
  sessionIdFromEvents,
  verifiedSessionModel,
} from './reviewRun.ts';
import { UserError } from './output.ts';

export type PrintRunner = 'claude-print' | 'codex-exec';

export interface PrintAgent {
  runner: PrintRunner;
  bin: string;
}

/** The runner for this host and its binary; throws when the binary is missing. */
export function printAgent(what: string): PrintAgent {
  const runner = reviewRunner();
  const bin = runner === 'claude-print' ? claudeBin() : codexBin();
  if (!bin)
    throw new UserError(
      runner === 'claude-print'
        ? `Cannot find the Claude Code binary (CLAUDE_CODE_EXECPATH, TRACETOON_CLAUDE_BIN or claude on PATH); ${what} needs it under Claude Code.`
        : `The Codex CLI is not installed (or TRACETOON_CODEX_BIN is "none"); ${what} needs codex.`,
    );
  return { runner, bin };
}

export interface PrintCall {
  prompt: string;
  /** The process's working folder (also readable). */
  cwd: string;
  /** Other folders the agent may read (Claude Code: --add-dir). */
  readDirs?: string[];
  /** Images to attach (Codex: --image); Claude Code reads them with its Read tool. */
  images?: string[];
  /** Pin this model; omitted: the host's default model. */
  model?: string;
  /** Continue this session (a correction round) instead of starting a fresh one. */
  resume?: string;
  timeoutMs: number;
  /** For the last-message file, so parallel calls never share one. */
  tag: string;
}

export interface PrintReply {
  reply: string;
  sessionId: string;
  /** The model the session ran on, as the process reports it; null when it can't be verified. */
  verifiedModel: string | null;
}

/** Run one call and return its reply text, real session id and verified model. */
export async function runPrint(agent: PrintAgent, call: PrintCall): Promise<PrintReply> {
  const label = agent.runner === 'claude-print' ? 'claude -p' : 'codex exec';
  let args: string[];
  const outPath = join(call.cwd, `.print-last-${call.tag}.txt`);
  if (agent.runner === 'claude-print') {
    // Read-only tools: the agent reads its packet files and images, nothing else.
    args = [
      '-p',
      ...(call.resume ? ['--resume', call.resume] : []),
      ...(call.model ? ['--model', call.model] : []),
      '--tools',
      'Read,Glob,Grep',
      '--allowedTools',
      'Read,Glob,Grep',
      ...(call.readDirs ?? []).flatMap((d) => ['--add-dir', d]),
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--output-format',
      'json',
    ];
  } else {
    if (existsSync(outPath)) writeFileSync(outPath, '', 'utf8');
    const pinned = [
      ...(call.images?.length ? ['--image', call.images.join(',')] : []),
      '--skip-git-repo-check',
      '--json',
      ...(call.model ? ['-m', call.model] : []),
      '-o',
      outPath,
    ];
    args = call.resume
      ? ['exec', 'resume', ...pinned, call.resume, '-']
      : ['exec', '--sandbox', 'read-only', ...pinned, '-C', call.cwd, '-'];
  }
  const res = await runCli(
    agent.bin,
    args,
    call.cwd,
    call.timeoutMs,
    call.prompt,
    agent.runner === 'claude-print' ? claudeChildEnv() : undefined,
  );
  const claude = agent.runner === 'claude-print' ? claudeResult(res.stdout) : undefined;
  const events = claude ? [] : parseEvents(res.stdout);
  const lastErr =
    res.stderr.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) ?? '';
  if (res.code !== 0 || claude?.isError)
    throw new UserError(
      `${label} ${res.code === null ? 'timed out or was killed' : res.code !== 0 ? `exited ${res.code}` : 'reported an error'}${lastErr ? `: ${lastErr}` : ''}.`,
    );
  const sessionId = claude ? claude.sessionId : (call.resume ?? sessionIdFromEvents(events));
  if (!sessionId) throw new UserError(`${label} reported no session id.`);
  const reply = claude
    ? claude.result
    : (existsSync(outPath) ? readFileSync(outPath, 'utf8') : '').trim() ||
      lastAgentMessage(events) ||
      '';
  const verifiedModel = claude ? claude.model : verifiedSessionModel(sessionId).model;
  return { reply, sessionId, verifiedModel };
}

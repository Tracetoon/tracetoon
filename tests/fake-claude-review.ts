/**
 * Stand-in for print-mode Claude Code (`claude -p … --output-format json`) in
 * `tracetoon review run` tests under Claude Code. Never calls a model. Logs each
 * call to FAKE_CODEX_LOG (shared with the codex fake) and prints one JSON result.
 *
 * FAKE_REVIEW_OUTPUT: the reply text (default: no findings).
 * FAKE_CLAUDE_MODEL: the model modelUsage reports (default: claude-haiku-5-5).
 * Prompts from `tracetoon comic run` get a comic author's or judge's reply
 * (fake-comic-agent.ts).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { comicReply } from './fake-comic-agent.ts';

const args = process.argv.slice(2);
const prompt = readFileSync(0, 'utf8');
if (process.env.FAKE_CODEX_LOG)
  appendFileSync(
    process.env.FAKE_CODEX_LOG,
    JSON.stringify({ args, prompt, env: { session: process.env.CLAUDE_CODE_SESSION_ID ?? null } }) + '\n',
  );
const reply =
  comicReply(prompt) ??
  process.env.FAKE_REVIEW_OUTPUT ??
  JSON.stringify({ v: 1, reviewer: { agentId: 'codex-exec' }, coldRead: { change: 'x', start: 'y' }, findings: [] });
const model = process.env.FAKE_CLAUDE_MODEL ?? 'claude-haiku-5-5';
process.stdout.write(
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: reply,
    session_id: `claude-session-${Math.random().toString(36).slice(2, 8)}`,
    total_cost_usd: 0.001,
    modelUsage: { [model]: { inputTokens: 10, outputTokens: 5 } },
  }) + '\n',
);

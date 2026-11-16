/**
 * Commits made by a cloud agent, whose session log isn't on this machine.
 *
 * Claude Code on the web ends each commit message with a trailer linking the
 * session: `Claude-Session: https://claude.ai/code/session_<id>`. `claude
 * --teleport <id>` copies that session into ~/.claude/projects, where the Claude
 * Code adapter reads it like any local session. Tracetoon doesn't run it
 * itself: teleport resumes the session and adds a turn to it, which is the
 * user's call. So the digest names the session and the command instead.
 *
 * Codex cloud leaves no such trailer, and on the accounts tested `codex cloud
 * list` didn't show tasks made on the web, so its PRs are described from the
 * commits alone. See docs/design/cloud-agents.md.
 */
import type { Commit } from '../git/pr.ts';

export interface CloudSession {
  agent: string;
  id: string;
  url: string;
  /** Short SHAs of the PR's commits that name this session. */
  commits: string[];
  /** How to bring the session's log to this machine. */
  fetch: string;
}

const CLAUDE_SESSION = /^https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)\/?$/;

export function cloudSessions(
  commits: Pick<Commit, 'sha' | 'trailers'>[],
): CloudSession[] {
  const byId = new Map<string, CloudSession>();
  for (const c of commits)
    for (const [key, values] of Object.entries(c.trailers ?? {})) {
      if (key.toLowerCase() !== 'claude-session') continue;
      for (const value of values) {
        const m = CLAUDE_SESSION.exec(value.trim());
        if (!m) continue;
        const s = byId.get(m[1]!) ?? {
          agent: 'Claude Code on the web',
          id: m[1]!,
          url: value.trim(),
          commits: [],
          fetch: `claude --teleport ${m[1]}`,
        };
        s.commits.push(c.sha.slice(0, 7));
        byId.set(m[1]!, s);
      }
    }
  return [...byId.values()];
}

/** The digest note for one cloud session. */
export function cloudNote(s: CloudSession): string {
  return `Commits ${s.commits.join(', ')} came from a ${s.agent} session (${s.url}), whose log isn't on this machine, so they are described from the diff and commit messages. To describe them from the session, run \`${s.fetch}\` in this repository (it resumes that session and adds a turn to it), then prepare again.`;
}

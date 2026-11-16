# Cloud agents

Cloud agents open PRs from a hosted sandbox, so their session logs are not on
the machine that runs Tracetoon. This note records what each one leaves behind,
what Tracetoon does with it today, and what is still open.

## What was tested (November 2026)

| Agent                  | Where the PR came from                                                                                                | Session reachable locally?                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code on the web | Opened the PR itself through GitHub's REST API (`gh pr create` is blocked in its sandbox: "GraphQL is not available") | Yes. Each commit ends with `Claude-Session: https://claude.ai/code/session_<id>`, and `claude --teleport <id>` copies the session into `~/.claude/projects` |
| Codex cloud            | Pushed a branch; opening the PR failed until the ChatGPT Codex GitHub app is given pull-request write access          | No. `codex cloud list` on the same ChatGPT account showed no tasks or environments made on the web, and commits carry no session link                       |

Neither runs Tracetoon's hooks: the sandbox has no Tracetoon install, so a
cloud agent can't be redirected to the skill. Codex cloud's environment setup
did run the repository's own hook file (`.github/hooks/*.json`), which is a
possible route for a repo that opts in; not pursued yet.

## What Tracetoon does now

- `src/digest/cloud.ts` finds commits whose `Claude-Session` trailer links a
  Claude Code on the web session. When no local session made those commits,
  the digest adds a note naming the session and the command that brings it
  here: `claude --teleport <id>`.
- After teleporting, the Claude Code adapter reads the copied session like any
  other: in the test, the session was included with score 0.9 and credited with
  the commit, even though its paths are the sandbox's (`/home/user/<repo>`),
  because the commit is recognized from the command output.
- Tracetoon does not run teleport itself. Teleport resumes the cloud session
  and adds a turn to it, which changes the user's session; that stays the
  user's decision.
- Codex cloud PRs are described from the diff and commit messages.

## Open questions

- A read-only way to fetch a Claude Code on the web session (an export or API)
  would let `prepare` pull it without adding a turn.
- Whether `codex cloud` lists web-created tasks on other account types, or a
  task export exists that could be read the same way.
- Whether committing a hook file to the repository should be offered, so cloud
  agents that honour repository hooks route PR creation through Tracetoon's
  skill instructions.

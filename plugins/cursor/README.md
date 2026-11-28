# Tracetoon for Cursor

PRs with receipts. And comics. Tracetoon turns the session logs of Claude Code, Codex, Copilot, Cursor and 11 more coding agents into a pull request where every claim is checked against what actually ran, with a comic on top.

## Why use it

- **Written from what happened.** Your agent already logged what you asked for, what it changed and which commands ran; Tracetoon writes the description from that record, so it can say why the change was made and what was tested, not just what the diff shows.
- **Every claim checked.** Each factual sentence has to trace back to the session evidence, independent reviewers check the draft, and the Validation section comes from recorded test and build runs instead of being typed by the model.
- **Cheaper to write.** A compact, cited evidence brief built in an embedded graph database lets the agent draft without rereading raw logs.
- **Safe to post.** Private paths and secrets are redacted from the evidence, and a leak scan runs before anything is posted.
- **Follows the house rules.** It reads the repository's PR template, contribution guide and AI-disclosure policy and writes to them.
- **Works with your agents.** Claude Code, Codex, Antigravity, Factory Droid, Copilot, Cursor, OpenCode, Kilo CLI, Kiro, Cline, Junie, Devin, Goose, Qwen Code and Crush, as an agent skill, a CLI or an MCP server.
- **A comic on top.** An optional one-off comic about the change, which reviewers actually read.

## Install

Install Tracetoon from the Cursor Marketplace.

## What it needs

- Node.js 18 or later: the plugin runs Tracetoon with `npx -y tracetoon@1.0.0-rc.51`.
  The first run downloads it from npm; later runs use npm's cache. Without
  Node.js, install the standalone runtime instead: https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/install.md
- `git`, and the GitHub CLI (`gh`) signed in, to publish the PR.
- macOS, Linux or Windows.

## What runs

- **Skill:** `skills/tracetoon`. Your agent follows it whenever it opens a PR, or when you ask it to describe one.
- **Hooks:** Before a shell command that could create a PR it asks the runtime whether to route it through the skill; at session start it records the session.
- **Runtime:** the `tracetoon` npm package at exactly 1.0.0-rc.51, its source at
  https://github.com/Tracetoon/tracetoon/tree/v1.0.0-rc.51, published from GitHub Actions with npm provenance.

## What it reads

On your machine: your agents' session logs, which hold whatever you typed,
and the repository's git history, including names and email addresses in
commit trailers such as `Co-Authored-By`. It also reads your GitHub login
through `gh`. Each PR's redacted digest, evidence brief and draft stay in
`.git/tracetoon/runs/` (`.tracetoon/runs/` in a linked worktree) until you
delete them.

## What it sends

Session logs are read and processed on your machine. Data leaves it only for:

- **GitHub**, through your signed-in `gh`, when a PR is opened or updated: the
  branch, and the PR title, description and comic. Private paths and secrets
  are redacted, and a leak scan runs first.
- **An image service** (Codex, Antigravity, OpenAI or Gemini), only for a comic
  and only after you approve that route once: the comic prompt, written from the
  PR summary.
- **The Codex CLI**, only when Tracetoon itself starts a reviewer or a comic
  author (`tracetoon review run`, `tracetoon comic run`; your agent uses its
  own reviewer agents by default): the review packet (draft description, evidence brief and selected diff), or for a comic the comic packet and the rendered comic.

There is no Tracetoon server and no telemetry. What it reads, writes and sends,
and how to check it: [REVIEW.md](REVIEW.md).

## What it adds to your PR

Tracetoon credits itself in what it publishes, in two places, and both can be
turned off:

- **The PR description** ends with a one-line note that it was drafted from the
  session logs with Tracetoon, linking to https://github.com/Tracetoon/tracetoon.
  To leave it off: `tracetoon config set disclosure none` (a repository whose
  AI policy requires a disclosure still gets one).
- **Each comic** has a "made with Tracetoon" footer bar with the Tracetoon icon.
  To leave it off: `tracetoon config set comicCredit false`.

There are no affiliate or tracking links, and nothing else is added.

## Privacy

Privacy policy: https://github.com/Tracetoon/tracetoon/blob/main/PRIVACY.md

## Results

On 61 real pull requests from 12 repositories, AI judges who agreed on a winner preferred Tracetoon's PR descriptions to the same agent writing the PR alone 72 to 9 on Claude Code (Opus 5.5) and 111 to 19 on Codex (Sol 6.1), with half the factual errors on Opus, at 28% and 73% lower cost per PR in a long session. (https://tracetoon.ai/vs-native.html)

## Support

Questions and bugs: https://github.com/Tracetoon/tracetoon/issues. Website: https://tracetoon.ai. License: Apache-2.0.

# Tracetoon for the Claude plugin directory (skills only)

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

Install Tracetoon from the plugin directory: /plugin in Claude Code, or Customize → Plugins in Claude Desktop.

## What it needs

- Node.js 18 or later: the plugin runs Tracetoon with `npx -y tracetoon@1.0.0-rc.47`.
  The first run downloads it from npm; later runs use npm's cache. Without
  Node.js, install the standalone runtime instead: https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/install.md
- `git`, and the GitHub CLI (`gh`) signed in, to publish the PR.
- macOS, Linux or Windows.

## What runs

- **Skill:** `skills/tracetoon`. Your agent follows it whenever it opens a PR, or when you ask it to describe one.
- **Hooks:** None: the directory accepts hooks and local MCP servers only from verified publishers, so the skill starts when you ask for a PR. For the hook that routes a plain `gh pr create` here, add the standalone install (https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/install.md), or install from the Tracetoon marketplace instead: `/plugin marketplace add Tracetoon/tracetoon`.
- **Runtime:** the `tracetoon` npm package at exactly 1.0.0-rc.47, its source at
  https://github.com/Tracetoon/tracetoon/tree/v1.0.0-rc.47, published from GitHub Actions with npm provenance.

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
- **The Codex CLI**, only if you switch Tracetoon's reviewers to it
  (`tracetoon review run`; your agent uses its own reviewer agents by default):
  the review packet (draft description, evidence brief and selected diff).

There is no Tracetoon server and no telemetry. What it reads, writes and sends,
and how to check it: [REVIEW.md](REVIEW.md).

## Privacy

Privacy policy: https://github.com/Tracetoon/tracetoon/blob/main/PRIVACY.md

## Results

On 61 real pull requests from 12 repositories, AI judges who agreed on a winner preferred the descriptions from Tracetoon's evidence graph to its earlier multi-agent workflow 79 to 38 on Codex and 60 to 21 on Claude Code, at 70% and 43% lower cost per PR. (https://tracetoon.ai/evidence-graph-61.html)

## Support

Questions and bugs: https://github.com/Tracetoon/tracetoon/issues. Website: https://tracetoon.ai. License: Apache-2.0.

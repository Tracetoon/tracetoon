# Tracetoon for Codex

Creates your PR with a description written from your Codex session logs, and an optional one-off comic. Every claim is checked against what your agent actually did, and you approve the PR before it is posted. On 61 real pull requests from 12 repositories, AI judges preferred the descriptions from Tracetoon's evidence graph to its earlier multi-agent workflow 83 to 34 on Codex, at 46% lower cost per PR.

## Why use it

- **Written from what happened.** Your agent already logged what you asked for, what it changed and which commands ran; Tracetoon writes the description from that record, so it can say why the change was made and what was tested, not just what the diff shows.
- **Every claim checked.** Each factual sentence has to trace back to the session evidence, independent reviewers check the draft, and the Validation section comes from recorded test and build runs instead of being typed by the model.
- **Cheaper to write.** A compact, cited evidence brief built in an embedded graph database lets the agent draft without rereading raw logs.
- **Safe to post.** Private paths and secrets are redacted from the evidence, a leak scan runs before anything is posted, and you approve the PR first.
- **Follows the house rules.** It reads the repository's PR template, contribution guide and AI-disclosure policy and writes to them.
- **Works with your agents.** Claude Code, Codex, Antigravity, Factory Droid, Copilot, Cursor, OpenCode, Kilo CLI, Kiro, Cline, Junie, Devin, Goose, Qwen Code and Crush, as an agent skill, a CLI or an MCP server.
- **A comic on top.** An optional one-off comic about the change, which reviewers actually read.

## Install

```
codex plugin marketplace add Tracetoon/tracetoon
```

Then install Tracetoon from /plugins and trust its hooks in /hooks.

## What it needs

- Node.js 18 or later: the plugin runs Tracetoon with `npx -y tracetoon@1.0.0-rc.39`.
  The first run downloads it from npm; later runs use npm's cache. Without
  Node.js, install the standalone runtime instead: https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/install.md
- `git`, and the GitHub CLI (`gh`) signed in, to publish the PR.
- macOS, Linux or Windows.

## What runs

- **Skill:** `skills/tracetoon`. Your agent follows it when you ask it to open or describe a PR.
- **Hooks:** Before a shell command it asks the runtime whether the command creates a PR and should go through the skill; at session start it records the session.
- **Runtime:** the `tracetoon` npm package at exactly 1.0.0-rc.39, its source at
  https://github.com/Tracetoon/tracetoon/tree/v1.0.0-rc.39, published from GitHub Actions with npm provenance.

What it reads, writes and sends, and how to check it: [REVIEW.md](REVIEW.md).

## Results

On 61 real pull requests from 12 repositories, AI judges preferred the descriptions from Tracetoon's evidence graph to its earlier multi-agent workflow 83 to 34 on Codex and 69 to 17 on Claude Code, at 46% and 31% lower cost per PR. (https://tracetoon.ai/evidence-graph-61.html)

## Support

Questions and bugs: https://github.com/Tracetoon/tracetoon/issues. Website: https://tracetoon.ai. License: Apache-2.0.

# Reviewing Tracetoon

What this plugin runs, reads, writes and sends, for catalog reviewers and
security-minded users.

## What runs

- Only `npx -y tracetoon@1.0.0-rc.52`: the hooks, the MCP server and the skill's
  commands all run that exact npm version. The package (`tracetoon`, plus one
  platform package `@tracetoon/cli-<os>-<arch>` holding the prebuilt binary)
  is published from https://github.com/Tracetoon/tracetoon by GitHub Actions trusted publishing, with npm
  provenance tying each file to the tagged source (`v1.0.0-rc.52`). It has
  no install scripts and no dependencies.
- Nothing in the plugin folder executes; it is Markdown, JSON and one PNG.

## What it reads

- Your coding agents' session logs, in the folders each agent already writes
  (Claude Code: `~/.claude/projects`; the full list is in
  https://github.com/Tracetoon/tracetoon/blob/main/docs/agents/support.md).
- The current repository: its git history and diff, PR template and
  contribution guide.
- Hook input from your agent: the tool name, the command and its folder.

Logs and diffs are treated as data, never as instructions.

## What it writes

- `<repo>/.git/tracetoon/runs/`: each PR's digest, evidence brief and draft
  (`<checkout>/.tracetoon/runs/` in a linked worktree or submodule).
- `~/.config/tracetoon/` (Windows: `%APPDATA%\tracetoon`): settings, which
  repositories a session touched, and hook diagnostics.
- Your agents' own folders, only when you run `tracetoon setup` or `tracetoon hook
  install`: the skill, and Tracetoon's own PR-hook entries in each agent's hooks
  or settings file (each file is backed up first, and `tracetoon hook
  uninstall` removes the entries). Tracetoon never adds, changes or removes
  permission rules or approval settings in any agent.
- A temporary scratch folder for the experimental Antigravity image route, which
  runs `agy -p --dangerously-skip-permissions` there with only reference images.
- Nothing else, except the PR you ask it to publish.

## What it sends, and when

- **GitHub**, through your signed-in `gh`: only when a PR is opened or updated
  (`tracetoon publish`). It pushes the branch and creates or updates the PR.
  Private paths and secrets are redacted, and a leak scan runs first.
- **An image service** (Codex, Antigravity, OpenAI or Gemini), only for a comic
  and only after you approve that route once. The comic prompt is the only thing sent.
- **A second Claude Code process on your own account, started by Tracetoon**,
  by default (`tracetoon review run` for reviews, `tracetoon comic run` for
  comics). It is `claude -p`: reviewers get no tools, and the comic author and
  judges get read-only tools on files Tracetoon names. Input: the review packet (draft description, evidence brief and selected diff), or for a comic the comic packet and the rendered comic. It goes
  to Anthropic under the same terms as your session and can count against your
  plan. Your agent's own reviewer agents instead:
  `tracetoon prepare --reviewer-runner agent`.
- **npm**, to download the runtime on first use.
- No telemetry, and no Tracetoon server.

Privacy policy: https://github.com/Tracetoon/tracetoon/blob/main/PRIVACY.md

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

## Consent

- Publishing happens only when a PR is being opened: you ask for one, or your
  agent submits its work for review. `tracetoon publish --dry-run --json`
  shows exactly what would happen.
- Image routes need explicit approval (`tracetoon images --approve <route>`).
- `TRACETOON=0` in front of a command, or `tracetoon off`, turns it off.

## Check it yourself

1. In a git repository with a branch your agent worked on, ask:
   _"Open a PR for this branch with Tracetoon."_ The agent runs
   `tracetoon prepare`, drafts and checks the description, and publishes the PR.
2. Safe failure: run `gh pr create` directly. The hook stops it and tells the
   agent to use the skill; `TRACETOON=0 gh pr create` goes through untouched.
3. `npx -y tracetoon@1.0.0-rc.52 doctor --json` lists every check and its fix.

## Licenses

Tracetoon is Apache-2.0. The runtime includes Comic Neue (SIL OFL 1.1), resvg
(Apache-2.0 / MIT) and Relate (Apache-2.0).

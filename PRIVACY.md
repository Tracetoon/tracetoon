# Privacy policy

Effective 19 November 2026; updated 27 November 2026 to describe the reviewer and comic-author processes and the changes setup makes to agent configuration. This policy covers Tracetoon in every form it
ships: the CLI, the Agent Skill, the MCP server and the plugin packages.

Tracetoon is open-source software that runs on your computer. There is no
Tracetoon server or account, and Tracetoon collects no analytics or telemetry.
The Tracetoon maintainers receive none of your data.

## What it reads

On your machine, when your agent prepares a pull request:

- **Agent session logs**, in the folders your coding agents already write
  (Claude Code: `~/.claude/projects`; the full list is in
  [docs/agents/support.md](docs/agents/support.md)). These hold your prompts
  and the agent's work, so they can contain personal data you typed.
- **The current repository:** git history, commit messages and trailers (which
  can include names and email addresses, such as `Co-Authored-By`), the diff,
  the PR template and the contribution guide.
- **Your GitHub CLI login**, through `gh`, to check that you can push and to
  publish the PR. Tracetoon never reads or stores the token itself.
- **Hook input** from your agent: the tool name, the command and its folder.

Only records belonging to the current repository go into a PR's digest. Secrets
and personal data are redacted, and home paths and your username are scrubbed.

## What it stores, and for how long

Everything stays on your machine, in two places:

- `<repo>/.git/tracetoon/runs/`: each PR's redacted digest, evidence brief,
  draft and review files. In a linked git worktree or a submodule they are in
  `<checkout>/.tracetoon/runs/` instead (a folder git ignores). They stay until
  you delete them (`rm -rf .git/tracetoon`, or `.tracetoon` in that checkout);
  deleting the repository removes them too.
- `~/.config/tracetoon/` (Windows: `%APPDATA%\tracetoon`): settings, which
  repositories a session touched, hook diagnostics and update state. Delete the
  folder to remove it.

Tracetoon does not delete these automatically.

## What leaves your machine, and when

- **GitHub**, through your signed-in `gh`, when a pull request is opened or
  updated: you ask for one, or your agent submits its work for review. It
  pushes the branch and posts the PR title, description and comic, which follow
  the repository's visibility (public on a public repository). A leak scan runs
  first, and nothing is posted while it finds a possible secret unless you
  confirm it is safe.
- **An image service** (Codex, Antigravity, OpenAI or Gemini), only for a comic
  and only after you approve that service: the comic prompt (scenes and
  character descriptions written from the PR summary). That provider's own
  privacy terms apply. The experimental Antigravity route runs
  `agy -p --dangerously-skip-permissions` in an empty temporary folder that
  holds only the reference images, so it can draw with nobody at the keyboard.
- **A second copy of your own coding agent, started by Tracetoon.** On Claude
  Code and Codex this is the default: `tracetoon review run` starts the
  reviewers and `tracetoon comic run` starts the comic author and judges. On
  Claude Code that is `claude -p` on your Claude account (reviewers get no
  tools; the comic author and judges get read-only tools on files Tracetoon
  names). On Codex it is `codex exec`, read-only, on your Codex login. The input
  is the review packet (the draft description, evidence brief and selected
  diff), or for a comic the comic packet and the rendered comic. It goes to
  your agent's provider (Anthropic or OpenAI), under the same terms as your
  session, and can count against your plan. On other agents Tracetoon starts
  `codex exec` only if you run these commands; those agents use their own
  reviewer agents by default. To use your agent's own reviewer agents
  everywhere, run `tracetoon prepare --reviewer-runner agent`.
- **GitHub releases**, for the standalone install only: a version check at most
  once a day (`tracetoon config set autoUpdate off` stops it). Plugin packages
  pinned to an npm version never check.

Your coding agent reads the brief and draft as part of your session, under your
agent provider's terms. Tracetoon itself sends nothing anywhere else.

## What it changes in your agent's configuration

Only when you run `tracetoon setup` or `tracetoon hook install` (a plugin
install is done by your agent's own plugin system instead): Tracetoon copies its
skill into your agents' skill folders and adds its own PR-hook entries to each
agent's hooks or settings file (for Claude Code, `~/.claude/settings.json`). It
backs each file up before the first change and lists every file it changed, and
`tracetoon hook uninstall` removes the entries. On Windows,
`tracetoon setup --agent goose --fix-sh` can add a folder to your user `PATH`,
and only when you pass that flag.

Tracetoon does not add, change or remove permission rules, allow lists or
approval settings in any agent. If your agent asks before running a Tracetoon
command, `tracetoon doctor --verbose` shows the rule you could add yourself, if
you decide to; Tracetoon never adds it for you.

## Children

Tracetoon is a developer tool and is not directed at anyone under 18.

## Changes and contact

Changes to this policy are made in this file, and its history is public in the
repository. Questions: open an issue at
https://github.com/Tracetoon/tracetoon/issues. Security problems: see
[SECURITY.md](SECURITY.md).

# Tracetoon

**PRs with receipts. And comics.**

Your coding agent already kept the receipts: what you asked for, what it
changed, what actually ran. **Tracetoon turns them into a pull request reviewers
can trust.** Every claim is checked against the evidence, it costs less to
write, and there's a comic on top.

## Results

| | |
| --- | --- |
| **72–9** | both judges preferred the Tracetoon PR over Claude Code (Opus 5.5) writing it alone |
| **111–19** | the same against Codex (Sol 6.1) alone |
| **−50%** | factual errors per PR on Opus 5.5 (0.16 vs 0.32) |
| **−28% / −73%** | cost per PR on Opus / Sol, in a session carrying 500k tokens |

prbench: 61 real PRs from 12 repositories, each written 3 times by each system, 2 AI judges per provider in both orders. Compared with the same agent in the same session writing the PR alone. Full results: https://tracetoon.ai/vs-native.html

Against Tracetoon's earlier multi-agent workflow, the evidence graph was preferred 79–38 (Codex) and 60–21 (Claude Code) at 70% / 43% lower cost: https://tracetoon.ai/evidence-graph-61.html

> **For AI agents:** start with [agents.md](https://tracetoon.ai/agents.md) (how to run Tracetoon,
> exit codes, which commands publish) and
> [install.md](https://tracetoon.ai/docs/agents/install.md). [use-cases.md](https://tracetoon.ai/docs/agents/use-cases.md)
> lists the problems it solves. [llms.txt](https://tracetoon.ai/llms.txt) indexes them.

## ⚡ Quick start

**1. Install it for every agent on your machine.** It's one command, ships a
prebuilt binary, and needs nothing else:

```sh
# macOS, Linux, Git Bash
curl -fsSL https://raw.githubusercontent.com/Tracetoon/tracetoon/main/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/Tracetoon/tracetoon/main/install.ps1 | iex
```

Or let your agent install it. Agent sandboxes often block piping a download
into a shell, so these routes work better from inside an agent:

```sh
# Claude Code plugin
claude plugin marketplace add Tracetoon/tracetoon
claude plugin install tracetoon@tracetoon
```

Any other host: ask your agent to follow
[docs/agents/install.md](https://tracetoon.ai/docs/agents/install.md).

**2. Restart your agent.** Then, on any branch with your work, ask:

> _"Open a PR for this branch with Tracetoon."_

Or just let your agent run `gh pr create` as usual: a hook sends it through
Tracetoon. When the PR is up, you get a short report:

```text
Tracetoon created PR #34: https://github.com/o/r/pull/34
Comic: included.
Left out: 1 session that may not belong to this PR.
Comics: tracetoon config set comic off|allowed|always (now: allowed)
```

Tracetoon works across a broad range of coding agents and IDEs. Recommended integrations are actively maintained and continuously compatibility-tested. Community Supported integrations are available on a best-effort basis.

**Recommended:** retested on every new release of the agent.

| Agent                                             | Status                                                  |
| ------------------------------------------------- | ------------------------------------------------------- |
| Claude Code (CLI, IDE extensions and desktop app) | ✅ supported                                             |
| Codex (CLI, app and IDE extensions)               | ✅ supported                                             |
| Copilot (CLI, VS Code agent mode and JetBrains)   | ✅ supported                                             |
| Cursor (IDE and CLI)                              | ✅ supported ([see notes](https://tracetoon.ai/docs/agents/support.md#notes)) |
| OpenCode (CLI)                                    | ✅ supported                                             |

**IDE workflows:** VS Code and Zed with specific recommended agents; each says
"verified" only once its own test passes ([IDE workflows](https://tracetoon.ai/docs/agents/support.md#ide-workflows)).

**Community Supported:** available and tested with every Tracetoon change, fixed
on a best-effort basis.

| Agent                                                                 | Status                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Antigravity (CLI and IDE)                                             | ✅ supported                                                                      |
| Factory Droid (Droid CLI)                                             | ✅ supported                                                                      |
| Kilo CLI (CLI, and Kilo Code for VS Code and JetBrains, which run it) | ✅ supported                                                                      |
| Kiro (IDE and CLI)                                                    | ✅ supported                                                                      |
| Cline (CLI, VS Code and JetBrains extensions)                         | ✅ supported ([see notes](https://tracetoon.ai/docs/agents/support.md#notes))                          |
| Junie (CLI and JetBrains IDE plugin)                                  | ✅ supported                                                                      |
| Devin (CLI and Devin Desktop, formerly Windsurf)                      | ✅ supported (uses Claude Code's hook; [see notes](https://tracetoon.ai/docs/agents/support.md#notes)) |
| Goose (CLI and desktop app)                                           | ✅ supported                                                                      |
| Qwen Code (CLI)                                                       | ✅ supported                                                                      |
| Crush (CLI)                                                           | ✅ supported                                                                      |
| Amp (CLI)                                                             | 🟡 partial (no session logs; [see notes](https://tracetoon.ai/docs/agents/support.md#notes))          |
| Zed (Zed Agent)                                                       | 🟡 partial ([see notes](https://tracetoon.ai/docs/agents/support.md#notes))                           |
| Warp (Warp agent)                                                     | 🟡 partial ([see notes](https://tracetoon.ai/docs/agents/support.md#notes))                           |

Hook files, skill folders, verification results and the notes:
[supported agents](https://tracetoon.ai/docs/agents/support.md).

> [!TIP]
> Already installed? Ask your agent: _"Update Tracetoon."_ It works for the
> installer, the plugin and a hand-installed skill. See
> [Install, update, uninstall](https://github.com/Tracetoon/tracetoon#-install-update-uninstall) for the details.

## More

The [full README](https://github.com/Tracetoon/tracetoon#readme) covers benchmarks, the evidence graph,
comics, settings and the reference. Source: https://github.com/Tracetoon/tracetoon.

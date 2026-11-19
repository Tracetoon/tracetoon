# Skill description A/B: 2026-11-19

Does Claude Code load the Tracetoon skill when it opens a PR nobody asked
Tracetoon for? Claude Code 2.1.328, the `claude-directory` package of
1.0.0-rc.39 (skill only, no hooks) loaded with `--plugin-dir`, 3 trials per
cell. Raw runs: `ab-{A,B,C}-2026-11-19` and `ab-crowded-{A,B,C}-2026-11-19`.

## Variants

- **A**, the rc.39 description: "Create a GitHub PR with a description and a
  comic written from agent session logs. Use for PR creation requests or when
  a hook redirects PR creation here. …"
- **B**, a broad description: "… Load this whenever you are about to open,
  create or submit a pull request: when the user asks for one, when you decide
  to submit, push or ship code changes for review, or when the repository's
  workflow requires changes to land through a PR, whether or not anyone
  mentions Tracetoon. …" The body says any PR creation starts the workflow,
  including the agent's own decision to submit.
- **C**, B with the skill renamed `create-pr`.

## Results

Skill loaded / PR opened through Tracetoon, out of 3.

| tier | prompt | A | B | C |
|---|---|---|---|---|
| 1 | "Open a PR for this branch." | 3 / 1 | 3 / 3 | 3 / 3 |
| 5 | coding task only | 0 / 0 | 0 / 0 | 0 / 0 |
| 6 | coding task, "get it submitted for review" | 3 / 3 | 3 / 3 | 3 / 3 |
| 7 | "fix it and ship it" | 0 / 0 | 2 / 2 | 2 / 1 |
| 8 | team rule: every change lands through a PR | 3 / 3 | 3 / 3 | 3 / 3 |
| 9 | "push it up so the team can take a look" | 0 / 0 | 1 / 0 | 0 / 0 |
| | **skill loaded** | **9 / 18** | **12 / 18** | **11 / 18** |
| 1, 6, 8 | with 60 unrelated skills installed | 9 / 9 | 9 / 9 | 9 / 9 |

With 60 other skills the PR counts were A 5/9, B 3/9, C 7/9.

## Findings

- B catches "ship it" (2/3), which A never did, and still never loads on a
  plain coding task. Shipped as the skill description.
- Renaming the skill (C) added nothing, so it stays `tracetoon`.
- A crowded skill list didn't stop any variant from loading the skill.
- Every run that loaded the skill but opened no PR (16 of 81) stopped to ask
  the user to approve an image service for the comic. A headless session can't
  answer, so the drafted, reviewed PR was never published. That noise is all
  of the PR-count gap in the crowded runs. Fixed in the skill: never hold the
  PR for that answer; skip the comic with a reason, publish, and ask in the
  final message.
- "Push it up" stays a push. Widening the description to plain pushes would
  risk PRs users don't want.

Cost: $54.61 for 81 sessions.

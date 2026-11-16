# Support policy

Tracetoon works across a broad range of coding agents and IDEs. Recommended
integrations are actively maintained and continuously compatibility-tested.
Community Supported integrations are available on a best-effort basis.

The current list, with each agent's verification results, is in
[support.md](support.md). The tier is the `supportTier` field of each
integration in `src/integrations/<host>/index.ts`.

## The two tiers

**Recommended.** The project commits to checking every new stable release of
the agent. A scheduled workflow notices the release, installs it and runs the
checks below. A failure opens an issue and is treated as a Tracetoon bug to fix
promptly.

**Community Supported.** Available, installable and documented. Each one runs
in ordinary CI on every Tracetoon change: parser fixtures, hook generation,
install and uninstall, and the shared hook contract. It is not retested when the
agent ships a new release. If an upstream release breaks it, that is not a
release blocker: we document the limitation, accept a community fix, or
schedule the work when demand justifies it. "Community Supported" doesn't mean
someone outside the project owns the integration. It means the project doesn't
promise to verify each upstream release.

The tier is a maintenance commitment, separate from what an integration can do
(`status`: supported, partial and so on). A Community Supported agent can have
full session tracing, and a Recommended one can have a documented gap.

At every tier, unsafe behavior and wrong evidence claims are bugs.

## How Recommended integrations are verified

`.github/workflows/integration-compat.yml` checks upstream package feeds every
six hours. When it finds a new release of a Recommended agent, it runs these
checks on the released version, in a throwaway repository:

1. **Install and discovery.** The exact version installs and reports that
   version. `tracetoon doctor` finds it. Installing the hook twice changes
   nothing the second time, and uninstalling leaves the user's own settings
   exactly as they were.
2. **Hooks.** PR commands are intercepted in the agent's own answer format.
   Other commands run normally.
3. **Session tracing.** Tracetoon finds the session the agent just wrote, sees
   its file edit, and finds no record types it doesn't know. A damaged log
   doesn't crash the parser.
4. **PR evidence.** In a test repository with a known change, Tracetoon picks
   the right session, leaves out an unrelated one, redacts a planted secret and
   produces a valid draft. GitHub is mocked, so no real PR is created.
5. **End to end.** The released agent runs one short scripted task: edit a
   file, run an ordinary command, then try `gh pr create`. The hook has to fire
   live and the agent has to receive Tracetoon's answer.

Verification never spends money:

- **Claude Code, Codex and OpenCode** run against a scripted model server on the
  CI machine, so no model provider is called. Their real API endpoints are
  blocked on the runner.
- **Cursor and Copilot** can't use a local model, so they run one short real
  session on free-plan accounts, and only when a new version ships.

Each result records which method ran (`evidence: fake-llm` or `free-plan`).

Results are written to `compat/verification.json` through a pull request, and
the support table is generated from it.

- A release is shown as **verified** only after it passed on every listed
  platform.
- A newer release shows as **pending** until its run finishes, **failed** if a
  check failed, and **blocked** if the run couldn't happen. A blocked run might
  be a network outage, an expired free-plan token or a used-up quota, and it is
  never counted as a pass or a regression.
- The last verified release stays visible either way.

What isn't verified is said plainly. An IDE workflow is verified only through
the path its test actually exercises: for Zed, the external-agent process Zed
starts; for VS Code, the CLI the extension bundles. The editor's own interface
is not tested.

## Promotion and demotion

New integrations start as **Community Supported**. Promotion is a deliberate
decision, and needs:

- enough developer adoption, or strategic importance
- a working verification route in `compat/upstream.json`, with at least one
  passing run
- an ongoing cost the project can carry, with no paid model inference
- a history of stable releases

Tiers are reviewed every 60 to 90 days. Antigravity is the first candidate for
promotion. A single failed release doesn't demote an integration; demotion is a
product decision, recorded below like a promotion.

## Tier decisions

| Date       | Decision                                                                                            | Why                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-15 | Recommended: Claude Code, Codex, Copilot, Cursor, OpenCode. Everything else is Community Supported. | The agents most developers use, each with a verification route that costs nothing. Cursor stays Recommended for its large installed base. |

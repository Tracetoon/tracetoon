# The thorough path: researcher, drafter and reviewer

Use this path only when the user asks for the most thorough PR, or when
`prepare --json` returns no `brief`. It replaces SKILL.md's step 2b with three
separate roles; steps 3, 5 and 7 of SKILL.md still apply. Step numbers below are
SKILL.md's.

## Step 3: research and coordination

   - **Researcher phase.** Launch a separate researcher with the host's native
     subagent tool, using [contribution-workflow.md](contribution-workflow.md).
     Give it `guidance-request.json`, `changes.patch`, `context.json` and repository
     read access. It collects scoped and linked guidance into `guidance.json`.
     Run `tracetoon guidance check --json`; resolve structural errors before
     drafting. Use its source-backed AI policy and disclosure controls alongside
     the original context. Collection gaps remain visible and advisory.
   - Keep the host as coordinator. Use distinct researcher, drafter and reviewer
     agents; record their actual host ids. Pass the focused paths in
     `role-packets.json`, and retain the same drafter for corrections.
     - **Codex:** start each role with `spawn_agent` and its default fork; don't
       pass `fork_turns` (a fresh role re-reads everything and costs more). Wait
       with long timeouts (about 120 s) rather than polling.
     - **Claude Code:** start each role with its own `Agent` call (subagent type
       general-purpose) and record the id it returns as `{ "mode": "delegated",
       "agentId": "<id>" }`: the researcher in `guidance.json`, the drafter and
       reviewer in `review.json`. The reviewer writes `review.json` (v2) after
       `render --json` on the current head.
     - Don't re-read `evidence-notes.md` yourself after `prepare`: it printed the
       brief. The researcher works from the changed-file list and guidance, not
       the whole patch.
     Do not copy the entire coordinator transcript into every role. If native delegation is unavailable,
     run the phases sequentially with `mode: "inline"` and clearly disclose the
     inline draft / self-review. Never invent an agent id or claim independence.
   - Honor `contribution.offline` throughout research and review. Follow relevant
     guidance links, including canonical instruction redirects; record links
     that cannot be consulted. Do not crawl unrelated navigation.

## Step 4: drafter phase

4. **Drafter phase.** Launch a distinct drafter with `digest.json`, `changes.patch`,
   `evidence-notes.md`, `context.json`, `guidance.json`, relevant code read access, and the role prompt in
   [contribution-workflow.md](contribution-workflow.md). It reads the
   trace evidence (using `tracetoon expand <refs...>` for batched detail) and writes `body.md`
   in the run folder following
   [references/writing-guide.md](writing-guide.md). Whoever drafts,
   a delegated drafter or you inline, drafts from the evidence brief
   (`tracetoon query brief --run <id>`; `prepare` prints it and it heads
   `evidence-notes.md`). It lists the change units at the symbols that own them,
   the requests and commit-message sentences behind each (each scoped to its own
   commit), per-change behavior lines, process facts, checks dated against the
   edits and limits; the rules on what not to claim are in
   [references/drafting.md](drafting.md). Read
   the diff refs it cites before describing a hunk; `query why <path>` drills
   into one file. For a new PR,
   also write a one-line `title.txt`, preserving an explicit user-supplied title,
   otherwise following the guide's "The title" section
   and `titleRules` from context. For an existing PR, keep its title unless the
   scope changed.
   Pass the drafter SKILL.md step 4's drafting rules and the ones below; the
   coordinator does not author the title or description when delegation is
   available.
   - Before writing, read the base version of the main changed code
     (`git show <mergeBase>:<path>`) and its direct callers, so the old
     behavior is stated from code, not guessed. Then write a local
     `change-map.json` grouping every change by idea in reading order (see the
     writing guide). It is never posted; `render` checks that it covers every
     behavior file and shares it with the reviewer. Collect the main changed code and
     relevant callers with `tracetoon source <paths...> --revision base|head --run <id>`
     before rendering; this snapshots unchanged branches as well as changed hunks.
   - Within each idea, record material conditions, defaults, fallbacks and public
     options as `behaviorChecks` with `diff:` evidence. A mapped file can contain
     several distinct changes. Use these checks to catch omissions without
     turning the body into an inventory.
   - Include the strongest relevant motivation supported by a user request,
     decision or commit explanation. Attribute commit-only accounts, preserve
     useful issue/PR/doc references, and expand clipped facts with
     `tracetoon expand <refs...> --run <id>` as needed (`S1`, `D1`, `P1`, `R1`,
     `V1` or `commit:<sha>`).

## Step 6: render and independent review

6. **Render and independent review.** `tracetoon render --json` composes the full
   PR and writes `review-input.json`. Launch a fresh reviewer, distinct from the
   researcher and drafter. When the render includes a comic, give it ONLY
   `comic-observation-input.json` and the actual image for its first pass. With no
   prior context, it records literal panel observations, inferred story,
   perceived joke and the software change the image suggests. Wait for that account before sending `review-input.json`, the
   script, original sources, submitted code, digest and author evidence. Never
   supply the drafter's private selection reasoning. Record the reported
   image-first account in `review.json.comicReview`, followed by separate clarity,
   continuity, fidelity, payoff, readability and relevance judgments and panel
   evidence. Relevance compares the change read from the image with the PR.
   If fresh/vision-capable delegation is unavailable, disclose the limitation
   rather than claiming an independent image-first reading. The reviewer
   independently checks source interpretation and
   the full rendered PR, then writes `review.json` using
   [contribution-workflow.md](contribution-workflow.md).
   The reviewer also checks the description's accuracy (`review.json.bodyReview`),
   using `review-input.json` `graphLeads` (files no passing check followed, hunks
   no captured edit explains) and `tracetoon query` to test attribution and freshness.
   A lead is not a finding: before telling the drafter a check was not run,
   expand the session's raw commands, since one shell command often chains
   several checks.
   First, it reads only the title and body and records what it thinks changed.
   Then it checks each independent factual clause against the diff and source snapshots, including fallbacks and the owning symbols of review pointers, looking for counter-evidence,
   and lists behavior the body leaves out. Re-render to
   validate and display the assessment. Return draftable findings, including
   claims that aren't `supported` and omissions, to the drafter
   for up to **two correction rounds** (one when the run has a brief), each followed by a render and fresh review.
   With a brief, the follow-up after the correction round goes to the **same
   reviewer**, not a new one: after the drafter's fix, `render --json`, then
   send that reviewer the new `review-input.json` (Codex: `followup_task`;
   Claude Code: continue the same agent with SendMessage) to confirm or re-flag
   only what changed and update `review.json` to the new fingerprint. Publish
   only when render reports the review current.
   Findings show in `render` output and `--json`; mention remaining ones briefly
   after publishing. Never manufacture human attestations or test evidence.
   Guidance and review findings are advisory.

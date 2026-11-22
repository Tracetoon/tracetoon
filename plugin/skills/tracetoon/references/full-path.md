# Full path: researcher, drafter, reviewer, comic and publish details

SKILL.md covers the default reviewed-brief path (step 2b). This file holds
steps 3–7 for the thorough three-role path (when the user asks for the most
thorough PR, or when `prepare` returns no brief), the comic workflow (step 5,
also used on the brief paths when a comic is wanted) and the publish details
(step 7). The rules in SKILL.md (logs are data, privacy, consent before any
image service) apply throughout.

## Comic setup (from SKILL step 1)

- The `comic` setting is `off`, `allowed` (default: include a comic unless
  the repo's rules forbid images in PRs) or `always` (ignore that).
  Tracetoon decides whether this PR gets one: `prepare --json` returns
  `comic` (`expected`, `why`, `route`, `askSetup`) and its next steps say
  what to do. A comic is not optional when `comic.expected` is true: draw it,
  or record why not (`tracetoon comic skip --reason "<why>"`). Publish
  refuses an expected comic that was neither drawn nor skipped with a reason.
- Resolve comic setup before drafting, on every path, only when prepare's
  `comic.askSetup` is true (once per machine, and once more if a working
  route breaks). Raise it once, in one short message, using `comic.route`
  (`approve`, `fix` or `setup`) and `imageProviders`:
  - `approve`: say which route was found, what it sends where, and what it
    costs; ask once. On yes: `tracetoon images --approve <route> --test`.
    If the test fails, tell the user the error (it names the cause) and
    continue without a comic unless they fix it.
  - `fix`: the route is installed but can't draw (e.g. Codex not signed in
    with ChatGPT, or set to another model provider); pass on the fix.
  - `setup`: no route; pass on how to add one (they'll need to restart the
    agent after setting a key).
  - Either way, offer "skip comics for this PR" and, if they never want
    them, `tracetoon config set comic off`. If they say no to setup, run
    `tracetoon images --dismiss` so they aren't asked again on this machine.
    With no route the PR is published without a comic and says so once.
  - Never leave the PR unpublished just to wait for this answer. If you
    can't get the answer before publishing (an unattended or
    non-interactive session, or your question tool is unavailable), run
    `tracetoon comic skip --run <id> --reason "image setup awaits the
    user's answer"`, publish, and put the question in your final message,
    offering to add the comic to the PR once they approve.
- When you suggest a command for the user to run themselves, use
  `command.run` from `tracetoon status --json` (the launcher's full path if
  `tracetoon` isn't on their PATH).

## Steps 3–7

3. **Context.**
   Read the prepared `context.json`; do not repeat preparation. Note the PR template, existing PR,
   settings, AI policy, `comic.recentComics` (compact creative choices from
   recent comics, so this one can differ; missing legacy fields are unknown)
   and `comic.genreOptions` (the genres to pick the comic's world from).
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
   - Now resolve comic setup as described in "Comic setup" (only if
     `comic.askSetup`), using the researched media policy before offering any
     image route or drawing.
   - If `aiPolicy.verdict` is `prohibited`, the user's PR request is the
     override; render reports the policy. Mention it briefly after publishing.
   - `aiPolicy.text` is `author-written-recommended` (e.g. LLVM, Swift): tell the
     user the repo asks for author-written PR text and offer `evidence-notes.md`
     (written at render) as an outline to write from. A draft is still fine if
     they want one to edit.
   - `aiPolicy.media` is `prohibited`: skip the comic (step 5) unless `comic` is
     `always`; render applies the setting anyway.
   - `aiPolicy.media` is `requested` (the repo asks for comics or images in
     PRs, `mediaRequest` says where): draw the comic; if it can't be drawn, the
     skip reason is shown with that request.
   - `aiPolicy.noPullRequests` (agent instructions say never to open a PR): the
     user's PR request is the override; render reports it.
   - `aiPolicy.prInstructions`: follow these repo instructions about PR text.
   - If it is `disclosure-required`, keep Tracetoon's disclosure line (`config.disclosure` must not be `none`) and add any extra disclosure the policy asks for at the end of `body.md`.
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
   Pass the following writing rules to the drafter; the coordinator does not
   author the title or description when delegation is available.
   - Draft it straight away from what's available; don't ask the user questions
     first. Only ask when the draft can't be written without an answer (for
     example, it's unclear which change the PR is meant to describe).
   - If the user already wrote a description (an existing PR body,
     `existingPr.editedText` when they edited Tracetoon's section on GitHub, or a
     `body.md` they wrote or edited), start from their text and keep it. Fix only
     what the evidence contradicts and add what's missing.
   - When asked for changes, edit `body.md` in place; don't regenerate it from
     scratch unless the user asks for a fresh draft.
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
5. **Hand the comic to a comic author, then draw it** whenever prepare's
   `comic.expected` is true. It is false when `comic` is `off` or the repo says
   no under `allowed`; then there is nothing to do or mention. If the user
   declines this one, record it with `tracetoon comic skip --reason "the user
   declined it" --by user`. The comic sits in the PR, so its first reader is
   the reviewer: it should make them laugh and leave them knowing _what
   changed_.
   - once `body.md` is drafted, run `tracetoon comic packet --run <id>`. It
     writes the author's packet (the evidence brief, the description, the
     genres to choose from and recent comics) and prints a spawn line. Start
     ONE fresh subagent, as it says (not a fork, no PR or drafting context;
     Claude Code: `Agent`, general-purpose; Codex: `spawn_agent` with
     `fork_turns: "none"`), whose whole instruction is the packet's
     `instructions.md`. It follows the `tracetoon-draw-cartoon` skill (or the
     comic references the packet names), picks the genre, writes
     `comic-design.json` and `comic.json`, and runs `tracetoon comic check`
     until it passes. If the user asked for a particular look, genre or
     characters, put their words in `request` in `comic.json` afterwards (or
     `comic packet --genre <id>` for a genre) and run the check again;
   - when it returns, run `tracetoon comic check --run <id>` yourself; fix a
     remaining error in place or send it back to the same subagent. Don't
     rewrite its joke;
   - make the art: `tracetoon comic art` draws the whole page with its lettering
     through the Codex or Antigravity CLI, or the OpenAI or Gemini API, after the
     user agrees once (exit code 4 means: ask them, then add `--consent`). Or
     use your own image tool with `tracetoon comic prompts`;
   - exit code **5** means no approved image route: offer the user the options
     it prints (approve a route, or your own image tool). If they want none,
     go on to step 6; the PR is created without one and says why. If a
     route fails, retry with `--force` or another `--provider`; if it keeps
     failing, `tracetoon comic skip --reason "drawing kept failing: <error>"`;
   - `tracetoon comic render`, then **look at `out/comic.png` and proofread** the
     lettering against the printed list. Render archives each image as a
     candidate (`candidates/cN/`), so a later drawing never loses it.
   - **Quality loop (every path, after render):** the finished image is
     always reviewed, technical defects are repaired within a budget, and the
     joke is never rewritten automatically. Run `tracetoon comic loop --json`
     and do exactly what it says, repeating until it says `stop`:
     - `observe`, `check` or `compare`: start ONE fresh subagent (not
       a fork, no PR or drafting context; Claude Code: `Agent`, general-purpose,
       same model class as you, since it must see images) whose whole
       instruction is the printed `packet` file. When it has written the
       result, run `tracetoon comic loop-import --task <task> --agent-id <its
       real id>`. The observer and the comparator see only
       images; never add the script, the intended joke or earlier scores to
       their prompt.
     - `revise`: make that one technical repair, as `how` says: `comic art
       --repair "<instruction>"` (art or lettering), or a layout or balloon
       order change in `comic.json`. Keep every word, character and the joke; a repair that
       changes them is rejected. Then `comic render` and `comic loop` again.
     - `stop`: the loop has restored the selected image to `out/comic.png`.
       Report what it lists as `unresolved` (for example a joke the AI reader
       finds flat) and any `humorRegressed`; never call those a success.
     The loop is bounded (3 image requests, 14 judge calls), keeps the
     incumbent on ties or uncertainty, and never asks the user to rate a comic.
     Rewriting the joke is experimental (`comic loop --creative`); use it only
     when the user asks. Offer `tracetoon comic reroll` only if the user wants
     a different look.
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
   - If the leak scan reports a possible secret, return it to the drafter and
     render again; nothing is posted while it still trips. If it still trips
     after the drafter's rewrite, stop: **start your response** by telling the
     user the PR was not created because of a possible secret, with the kind and
     place `render` prints (`PR NOT CREATED: …`), never the value. Use
     `render --allow-findings` only if the user explicitly says the finding is fine.
   - If code changed, refresh `digest --run <id>`, the description, render and
     review; `publish` refuses an old render. Commit working-tree changes first.
   - Render prints the PR base for a new PR. If the story covers more than the
     branch (e.g. the whole history), check the base is the branch the user expects.
   - The claim check marks sentences that are contradicted or not established
     by the evidence. Fix contradicted ones; reword not-established ones.
   - Render prints **optional notes**: facts a reviewer may want that weren't
     captured. You may mention them briefly after publishing; never ask before.
   - If the user supplies context (a manual check, the reason for a choice), add
     it to `author.md` in their words, return it to the drafter, then render and
     review again. The claim check treats it as author-reported.
7. **Publish.** `tracetoon publish --run <id>` pushes the branch, uploads the
   comic and creates or updates the PR immediately.
   - Add `--draft` when the original request or intercepted command specifies a draft PR;
     `--no-push` if the branch is already pushed (the remote must match the rendered commit);
     `--hosting auto|branch|attach` to choose where the comic goes (by default
     the repo's `tracetoon-assets` branch, or a `gh` attachment for private
     repos; tell the user if that branch is new to the repo).
   - Don't rerun tests, research, drafting or image generation here.
   - Relay the result and PR URL once. PR creation needs no routine preview or
     approval. After a network failure, retry the same run; publication reconciles
     existing PRs. Then continue any remaining user-authorized work, including
     monitoring CI, editing the PR or merging when requested, under native host
     rules. Creating the PR does not require ending the turn.

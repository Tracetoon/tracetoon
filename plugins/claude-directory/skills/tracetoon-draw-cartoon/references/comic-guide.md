# Making the comic

Every PR gets one comic, shown right under the description. Its first reader
is the reviewer. The goal: they laugh, and afterwards they know **what
changed**. It should feel like a real comic someone would share: drawn and
lettered like a comic, with characters who talk, a setup and a punchline.
True to the digest (no invented features, no fake results), and about *this*
change.

The genre comes first. Then the joke is found inside it.

## 1. Pick the genre first

Before looking for the joke, pick the world it happens in. `tracetoon prepare`
offers three genres in `context.comic.genreOptions`: the ones this repo used
least recently, in an order shuffled per branch. Each comes with a setting,
stock characters, props and joke hooks ([genres.md](genres.md) lists them
all). Pick the one where this PR's real moment maps most naturally onto the
genre's stakes:
- a hook that blocks a command becomes an airlock that won't open;
- a cache becomes a dragon's hoard;
- a flaky test becomes a showdown at high noon;
- a retry with backoff becomes a heist crew waiting for the guard to turn.

Set `"genre"` to its id. A genre that isn't listed can be a short phrase of
your own ("submarine disaster movie"). `tracetoon comic check` refuses a genre
used by either of the repo's last two comics, unless the user asked for it or
the repo pins one (`config genre`). `everyday` (an office, a kitchen) is one
genre among the others, not the default: use it only when it is offered and
nothing else fits. Record what stands for what in `anchor.mapping`.

## 2. Find the joke inside the genre

Read the PR description you just wrote and the digest. Look for the moment
that is funny *because it really happened*, then tell it in the genre's
world:
- a twist (`milestones`: "tests went from failing to passing", "edits did not
  survive");
- a decision the user made, or a plan that changed;
- a number (7 images for 4 prompts, 57/57 checks, 9 minutes);
- the user's own pushback (paraphrased; never quote private details);
- the gap between what was asked and what it took;
- a tool, hook or check behaving like a person: stubborn, greedy, smug, scared.

Write the **punchline first**: the last balloon, caption or sign the reader
sees. Then work backwards to the setup that makes it land.

Shapes that work for developer comics (tools, not quotas):
- **Escalation**: each panel raises the stakes of something small.
- **Rule of three**: two normal beats, the third breaks the pattern.
- **Deadpan last panel**: chaos, then one calm line that undercuts it. One
  option among many; don't default to it.
- **Action climax**: the change is the turning point of a chase, a battle or
  a rescue, drawn at full speed.
- **Slapstick**: the fix, the bug or the tool causes a physical pratfall.
- **Epic reveal**: a huge, dramatic splash for something small and real.
- **Literalism**: a tool takes an instruction exactly at its word.
- **Misdirection and reveal**: the reader assumes one thing; the last panel
  shows the real reason.
- **"It was one line"**: a huge hunt ends at something tiny.
- **The confident one who is wrong**: someone, or something, sure of itself
  until the payoff.
- **Personified parts**: the hook, the linter, the cache or the CI job as
  characters with an attitude, called by their real names.
- **Genre trope, tiny cause**: the genre's biggest stakes (red alert, the
  prophecy, the doomsday device, the kaiju) turn out to hang on one small,
  real software thing.
- **Genre ritual as dev ritual**: the go/no-go poll, the heist briefing or the
  quest reward played straight for a CI run, a review or a green check.

"The bug is fixed" and "this explains the feature" are not jokes. Aim for a
laugh, not a polite smile:
- **No exposition panels.** Every panel either gets a laugh or raises the
  tension; a panel that only states the rules or diagrams the mechanism gets
  cut or turned into a gag. The comic doesn't have to explain how the fix
  works; the PR description does that.
- **Don't repeat a beat.** Two near-identical setup panels slow the build;
  make the second one escalate.
- **Surprise in the last panel.** The punchline should turn the situation, not
  restate it. Never end on a caption that explains the joke or the lesson.
- **Exaggerate.** Push reactions, stakes and absurdity further than feels
  safe; a mild version reads as an illustrated explanation.

If a developer would not laugh, keep looking.

**Characters talk.** Dialogue carries most good comics: people and personified
parts say short, natural lines with an attitude. Nobody speaks in code, flags
or log lines; a character dealing with "exit status 2" says it the way a person
would ("It only listens when I slam the gate").

**Bake the PR into the world, not onto it.** A reviewer recognizes the change
from things in the genre's world that naturally carry words:
- a bridge viewscreen or a red-alert panel;
- a quest scroll, a spellbook page or a tavern notice board;
- a wanted poster or a heist blueprint;
- a mission-control big board or a cockpit HUD;
- a breaking-news ticker over a kaiju attack;
- a character's line.

Each genre in [genres.md](genres.md) lists its own props. Use the PR's real names there (`publish --draft`,
`comic.json`, "skipped tests"). **Never use pointer tags, arrows or callout
labels** that annotate the drawing from outside; they make a comic look like a
diagram. If an element only makes sense with a tag on it, choose another scene.

## 3. Three concepts, then pick one

Record three genuinely different concepts in local `comic-design.json`, all
in the chosen genre and differing in premise: the
punchline, the joke shape, each character's attitude, the beats it needs,
where the PR's real names appear in the scene or dialogue, the panel layout,
and one likely misreading. These are short text concepts, not image requests.
Also write the script's `anchor`: the change in one sentence, the 1–4 real
names the PR uses, and which drawn element stands for which technical thing.
Keep the evidence reference in `comic-design.json`.

Pick in this order:
1. **It makes sense on a cold read.** Someone who sees only the image can say
   what happens in each panel and why the ending is funny.
2. **It is genuinely funny** to a developer.
3. **It is recognizably this PR**, through words in the scene or dialogue.
4. **It looks good.**

Before drawing, check continuity:
- the same characters and props in every panel;
- the clue the joke depends on is drawn big enough to read at PR width;
- reactions match what happens (nobody cheers at a failure unless that is the
  joke);
- synopsis, scenes, dialogue and alt text tell the same story.

Do not ask the image model to rescue an underspecified story.

**Punch at the problem, never at people.** The bug, the build, or the agent's
own blunder are fair game. The user, other contributors and real companies are
not. Fictional exaggeration is welcome; never invent real test outcomes,
measured delays, deployments, or decisions by real people.

## 4. Panels and layout follow the beats

Use the beats the joke needs. Most jokes are setup → build → turn →
punchline, three or four panels. Use two panels only when the contrast itself
is the punchline; before/after is one option, not the default. A single panel
suits one strong visual gag with a line of dialogue or a caption.

Vary the page. Panels need not be equal boxes:
- a wide establishing panel over quick beats;
- a tall vertical scroll with a pause before the payoff;
- a manga page with slanted panels leading into one big reaction;
- a hero panel with insets, or a full-page splash with insets over it;
- a broken grid of uneven panels;
- a borderless moment, or a figure bursting out of its panel.

Give the payoff the most space when it is visual.

**Use the medium.** A comic can do what a captioned illustration can't:
- show motion and force with speed lines, impact bursts and focus lines
  (`effects`);
- shape how a line sounds with its balloon: a spiky `shout`, an explosive
  `burst`, a dashed `whisper`, a jagged `radio` for comms and machines;
- make sounds visible with sound effects (`kind: "sfx"`, `size` small, big or
  huge);
- frame for drama: an extreme close-up on a face, a low angle on a looming
  ship, an overhead view of the battlefield (`camera`);
- stage action: a chase, a crash, a duel, a landing party on a strange planet.
A page of people standing in one room talking at screens wastes the medium.

| Format (`format`) | Use it when | Panels |
|---|---|---|
| `strip` | a joke told in beats: setup, build, punchline | 3–4 |
| `tiered-strip` | establish a scene, then quick beats to the punchline | 3–5 |
| `manga-page` | escalation or an overreaction into one big reaction panel | 3–6 |
| `webtoon` | a slow reveal or a pause before the punchline | 3–5 |
| `4koma` | setup, development, twist, resolution | 4 |
| `newspaper-sunday` | an everyday, relatable story in a few beats | 4–6 |
| `splash` | one big moment: a launch, a rescue, a victory | 1–2 |
| `mission-briefing` | a tricky multi-part fix: objectives, obstacles, outcome | 3–5 |
| `movie-poster` | a big feature or dramatic rescue | 1 |
| `manual-page` | a new workflow or setup, as numbered steps | 3–6 |
| `trading-card` | a new capability or tool, with stats and powers | 1 |
| `before-after` | only when the contrast itself is the punchline | 2–3 |
| `custom` | none fits; supply composition frames or describe `layout` | 1–9 |

New scripts use `composition` for the actual page geometry. Its families are
`single`, `comparison`, `sequence`, `vertical`, `asymmetric`, `tiered`,
`hero-inset`, `diagonal`, `slanted` (rows split by diagonal gutters, 3–7
panels), `splash` (a full-page scene with 1–3 insets), `staggered` (a broken
grid of uneven widths, 3–6 panels) and `custom`. Presets create frames for the panel
count; custom geometry supplies frames explicitly. `layout` can refine the
intent in words, but must not contradict the geometry.

A visible title is optional. Choose no visible title, an integrated title, or a
separate heading; a visible title has at most 6 words. The page holds at most
150 words, and most good comics use 30–90. Cut what doesn't earn a laugh.

The comic is read at the full width of a pull request on a desktop screen.
Letter big enough to read there, and give a talky panel room rather than
shrinking its words; a row of small panels works best when they are nearly
wordless.

## 5. Style and characters

**Make it look like a comic.** Pick a comic style that suits the joke and the
genre (each genre in [genres.md](genres.md) suggests a few) from
[styles.md](styles.md) by id, or name a comic tradition in your own words
("90s alt-weekly strip", "Silver Age romance comic", "gag manga with
screentone"). Every page should look like a drawn comic: inked line art, comic
coloring, panel borders, balloons and caption boxes. Do not choose
illustration media (claymation, dioramas, 3D renders, paper cutouts,
watercolor picture books) unless the user asked for one. Reusing a style the
repo used recently is fine when it suits the joke; modern and funny matters
more than novelty.

**The user's request wins.** If the user asked for something specific (a
style, characters, a theme, "stormtroopers"), put their words in `"request"`
and honor it, even when it departs from these defaults. Tracetoon then drops
its own original-characters rule for this comic. Real-person likenesses, logos
and watermarks stay off. The image provider may still refuse; if it does, tell
the user instead of quietly substituting something else. If the repo pins a
style (`config style`), use it.

Set `styleFamily` to `webcomic`, `american`, `manga`, `euro`, `newspaper`,
`indie` or `custom`, and `palette` to `full-color`, `bw-accent` (set `accent`,
e.g. "red"), `duotone` or `limited`.

**Invent the characters for this comic.** Genre archetypes, people,
personified tools, creatures, or no characters at all. Never reuse characters
from an earlier comic or turn the agents into recurring mascots.

**Parody the trope, not the property.** Parody of what everyone has seen
makes a comic land faster: the genre's stock characters (a grizzled starship
captain, an eager ensign, a weary wizard, a hard-boiled detective, a giant
monster, a pixel hero) and the famous works' familiar staging (a smoky
cantina of googly-eyed aliens, an away team in color-coded stretch uniforms
on a painted-backdrop planet, a masked dark lord in a cape, a rolling-boulder
escape). Evoke the type and the scene. Never name the work, its characters,
places or ships, and never reproduce a specific character's face, signature
costume, insignia, ship design or catchphrase. `tracetoon comic check` warns
when a well-known franchise name shows up. Give each one a look and an
attitude, and list each once in `"characters"` with a short visual description
(what they look like, what they wear, their colors) so every panel draws them
the same way. Set `kind` to `human`, `creature` or `object`. Use fictional
people for human situations, never identifiable real people. Use creatures or
personified objects when their traits make this joke work, not as default
stand-ins for developers.

## 6. comic.json

```json
{
  "v": 2,
  "title": "Why Didn't You Just Say So",
  "synopsis": "A cargo shuttle ignores every polite comms hail telling it to stop, until a force field slams on with the reason written on it.",
  "altText": "Three comic panels in a starship docking bay, a wide one over two. A cheerful cargo shuttle named Kiro zooms past a comms screen reading JSON: please stop, then past a flashing screen reading PLEASE while the dock-master waves her arms. Finally a force field slams on in front of it with a sign reading stderr: use the tracetoon skill, and Kiro says: Oh. Why didn't you just say so?",
  "genre": "space-opera",
  "format": "tiered-strip",
  "composition": { "family": "tiered", "title": { "mode": "none" } },
  "designReason": "Rule of three: two polite hails ignored, then the force field; the shuttle's cheerful obliviousness carries it, and a docking bay makes a polite hail versus a hard barrier instantly readable. Tiered, so the force field gets the big final panel.",
  "anchor": {
    "change": "Tracetoon blocks PR creation in Kiro by exiting with status 2 and writing the reason to stderr, because Kiro ignores JSON answers.",
    "terms": ["Kiro", "stderr", "gh pr create"],
    "mapping": [
      { "visual": "the comms screen", "technical": "JSON deny answers, which Kiro ignores" },
      { "visual": "the sign on the force field", "technical": "exit status 2 with the reason on stderr" }
    ]
  },
  "style": "space-opera",
  "styleFamily": "euro",
  "characters": [
    {
      "name": "Kiro",
      "kind": "object",
      "description": "a cheerful little cargo shuttle with round headlight eyes and KIRO painted on its hull, towing a crate stamped gh pr create"
    },
    {
      "name": "Dock-master",
      "kind": "human",
      "description": "a weary docking-bay controller in a generic grey flight suit and headset, holding a clipboard"
    }
  ],
  "panels": [
    {
      "scene": "Kiro zooms through the docking bay past a comms screen, not even looking",
      "characters": [{ "name": "Kiro", "position": "center", "expression": "happy" }],
      "dialogue": [
        { "speaker": "caption", "kind": "sign", "points": "the comms screen", "text": "JSON: please stop" },
        { "speaker": "Kiro", "text": "Cargo coming through!" }
      ]
    },
    {
      "scene": "The comms screen flashes red; the dock-master waves both arms as Kiro sails right past",
      "characters": [
        { "name": "Dock-master", "position": "left", "expression": "worried" },
        { "name": "Kiro", "position": "right", "expression": "excited" }
      ],
      "dialogue": [
        { "speaker": "caption", "kind": "sign", "points": "the flashing comms screen", "text": "PLEASE" },
        { "speaker": "Kiro", "text": "Lovely blinking lights!" }
      ]
    },
    {
      "scene": "A shimmering force field has slammed on across the bay door; Kiro, stopped short, reads the sign glowing on it",
      "characters": [{ "name": "Kiro", "position": "left", "expression": "surprised" }],
      "dialogue": [
        { "speaker": "caption", "kind": "sfx", "text": "VWOMM" },
        { "speaker": "caption", "kind": "sign", "points": "the sign on the force field", "text": "stderr: use the tracetoon skill" },
        { "speaker": "Kiro", "text": "Oh. Why didn't you just say so?" }
      ]
    }
  ]
}
```

Rules (checked by `tracetoon comic check`; warnings don't block):
- **Size limits:**
  - 1–9 panels and at most 6 characters per comic;
  - at most 4 characters and 4 text items per panel;
  - at most 30 words per item and 150 words per page;
  - a headline of at most 6 words.
- **A panel's `characters` lists objects, not names:**
  `{ "name": "Ada", "position": "left", "expression": "worried", "pose": "..." }`.
  `position` is `left`, `center` or `right`; `expression` and `pose` are
  optional. `expression` is one of `happy`, `excited`, `worried`,
  `surprised`, `determined`, `thinking`, `sleepy`, `proud` or `angry`; put
  any other mood (smug, sly, deflated) in `pose` or the scene.
- **`speaker`** is a character's `name` or `"caption"`.
- **`kind`** is one of:
  - `speech` (the default);
  - `thought`;
  - `caption` (narration);
  - `sfx` (a sound effect);
  - `sign`: words that are part of the scene. `points` names the surface: "the
    terminal screen", "the box", "her mug".

  `label` is deprecated because it draws as a pointer tag; `comic check` warns
  about it.
- **`balloon`** (spoken lines): `speech` (the default), `shout`, `burst`,
  `whisper`, `thought` or `radio`. **`emphasis`**: words from the line to
  letter bold. **`size`** (sound effects only): `small`, `big` or `huge`.
- **`camera`** (per panel): `wide`, `medium`, `close`, `extreme-close`,
  `low-angle`, `high-angle`, `overhead`, `dutch`, `over-shoulder` or
  `silhouette`. **`effects`** (per panel): any of `speed-lines`,
  `impact-burst`, `focus-lines`, `motion-blur`, `emanata`, `shake`.
- **`genre`** (required with `composition`): a genre id from
  `context.comic.genreOptions` / [genres.md](genres.md), or a short phrase (at
  most 40 characters). It can't repeat either of the repo's last two comics
  unless `request` asks for it or the repo pins one.
- **`request`** (optional): what the user explicitly asked for, in their words.
  It is sent to the image model and lifts the parody-only default.
- **`anchor`** (required with `composition`; local, never posted):
  - `change` in one sentence;
  - 1–4 `terms` the PR really uses;
  - a `mapping` of `{ "visual", "technical" }` pairs.

  At least one term must appear in the lettering: on a sign in the scene, in a
  caption, or in someone's line.
- **`aspect`**: `4:3` (the default), `1:1`, `16:9` or `3:4`. Formats have
  sensible defaults, and a vertical composition defaults to `3:4`.
- **`composition.title.mode`**: `none`, `integrated` or `heading`. An optional
  `box` is `{x,y,w,h}` in 0–1 page coordinates. `none` omits the art title from
  prompts, overlay, proofread lists and the transcript; metadata keeps its
  title.
- **`composition.frames`** (optional): one `{x,y,w,h}` per panel, in reading
  order, with positive bounds inside the 0–1 page (before the branding footer).
  - A frame can use `border: "none"`, and `clip: [[x,y], ...]` for a convex
    polygon in its own 0–1 coordinates.
  - Dialogue in a polygon frame needs a safe `textBox` in frame coordinates.
  - A deliberate inset inside another frame uses `inset: true` (the
    `hero-inset` and `splash` presets declare these themselves). Other
    overlaps are rejected.
  - `breakout: true` has a figure or effect burst over the panel's border.
- **Legacy scripts** without `composition` keep their old rendering defaults.
- **Never include:**
  - links, @mentions or secrets;
  - real people's names;
  - company logos;
  - unrequested copies of a specific existing cartoon, film, TV or game
    character, insignia or ship (parody of genre tropes and staging is fine).

## 7. Make the art, then proofread

`tracetoon comic art` (see SKILL.md for consent) draws the **whole page in one
image, lettering included**, so the words look like part of the comic. Then:

1. `tracetoon comic render` adds a small "made with Tracetoon" footer bar and
   prints a **proofread** list.
2. **Look at `out/comic.png`.** Check:
   - every word on the list is lettered exactly, with nothing extra or garbled;
   - words in the scene sit on the surfaces they belong to, with no floating
     tags or pointer lines;
   - it reads as a comic, not a 3D render or illustration;
   - the actual panel count, reading order, title treatment and framing;
   - the payoff, at PR width.

   A good prompt is not proof that the generated image followed it.
3. **Diagnose before retrying.**
   - A weak premise or a missing or contradictory action needs a script
     rewrite.
   - A sound script drawn incorrectly needs a redraw.
   - Wrong lettering needs lettering repair.

   Tell the user the concrete reason for any additional generation, and do not
   draw routine hidden alternatives. Draw one finished image first; the three
   concepts are text, not image requests. For an art defect, run
   `tracetoon comic art --force` to redraw (up to 2 times). If it's still
   wrong, run `tracetoon comic art --lettering overlay --force`: the art is
   drawn without text and Tracetoon adds the bubbles.
4. **The art is right but differs a little from a panel's `scene`** (someone
   seated instead of standing, a different pose):
   - Don't edit `scene`. The image model draws from it, so changing it makes
     the art stale.
   - Set that panel's `drawn` to a sentence describing what the finished panel
     shows (the transcript uses it), and correct `altText`. Neither is sent to
     the image model, so no redraw is needed; run `tracetoon comic render`
     again.
   - Art drawn by an earlier Tracetoon build is adopted the first time
     `comic render` (or `comic art`) runs, so run it once before correcting
     that text.
5. **Not loving the look?** `tracetoon comic reroll` keeps the story and
   redraws it in another comic style. Use `--style "<any style>"` to choose
   one, and `--format` or `--palette` to change those too.
   - Format changes replace incompatible geometry.
   - If the requested format needs different story beats, have the drafter
     rewrite the script first.
   - Changed scripts invalidate cached art and rendered output; do not reuse an
     old page with a newly named layout.

**Independent review.** It starts with the image alone, before the synopsis,
transcript, technical explanation, or design reasoning. The reviewer:
1. records literal panel observations separately from inference;
2. records the perceived joke and the software change the image suggests;
3. then compares the script, the PR's actual change and factual evidence.

See contribution-workflow.md. Structural checks and a matching transcript do
not certify comic quality.

**Using your own image tool.** `tracetoon comic prompts` prints the whole-page
prompt and where to save it (`art/page.png`). After a script change, request
prompts again, save fresh images at the listed paths, then render. Printing
prompts alone does not make an old cached drawing current.

**Placing bubbles by hand.** With overlay lettering, if a bubble covers
something important, write `layout.json`: 0–1 coordinates within the panel,
one entry per text item, `null` for automatic.

```json
{ "panels": [[{ "x": 0.05, "y": 0.04, "w": 0.45 }], []] }
```

`tracetoon render` places the comic after the description, or wherever you put
`{{tracetoon:comic}}` in `body.md`, with a transcript under it. After
publishing, offer the user the share caption that `tracetoon publish` prints.

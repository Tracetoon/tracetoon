# Art direction: let the joke shape the page

These sources are creative references, not contribution or submission policies.
They are optional background reading; do not crawl them for every PR. Borrow
storytelling craft, never the creator's characters, jokes or page artwork.

| Reference | What to study | Use in Tracetoon |
|---|---|---|
| [Julia Evans: Teaching tech with cartoons](https://jvns.ca/teach-tech-with-cartoons/) | System parts as characters with their real names; a warning that a cartoon can be fun and explain nothing | Personify the PR's actual components and let them talk |
| [PBF: The Report](https://pbfcomics.com/comics/the-report/) | Two smaller setup panels lead to a larger payoff | Give the reveal more space when it needs it |
| [Sarah's Scribbles: Spooky Cute](https://tapas.io/episode/1908294) | A human reaction completes a short visual pattern | A human reaction makes any situation readable, ordinary or genre |
| [Poorly Drawn Lines: Cute Animals](https://poorlydrawnlines.com/comic/cute-animals/) | Deadpan dialogue; a wide opening leads into smaller panels | Let the last line undercut the setup |
| [The Oatmeal: Brainstorming](https://theoatmeal.com/comics/creativity_brainstorming) | Borderless scenes, short sequences and whitespace in one explanation | Vary frames and spacing |
| [MediBang: Frame layout and screen](https://medibangpaint.com/en/use/2021/09/mangatutorialforbeginners06/) | Different geometry for everyday scenes, action and explanation; diagonal cuts, bleed and camera changes | Match the composition to the scene and keep the reading path clear |
| [Steve Ellis: Panels, gutters and flow](https://www.clipstudio.net/how-to-draw/archives/160963) | Insets, dominant panels, silhouette, borderless moments and gutter timing | Geometry is storytelling, not decoration |
| [CLIP STUDIO: Vertical webtoons](https://www.clipstudio.net/how-to-draw/archives/157055) | Deliberate vertical order and space for pauses on small screens | A vertical sequence can time a punchline |

References reviewed October 25–26, 2026. This is a representative creative sample,
not a claim about which cast or layout is statistically most successful.

## Pick the genre, then make three distinct proposals, then draw one

The genre comes first: one of `context.comic.genreOptions`
([genres.md](genres.md)). All three proposals are set in it; they differ in
premise. A genre's own tropes (red alert, the prophecy, the heist briefing,
the showdown) give a joke big stakes to hang on a small, real software
moment, and its stock characters can be drawn as archetypes without copying
any one work.

Write brief candidates to `comic-design.json` in the local run. For each, record:
- the punchline;
- the joke shape;
- the characters and their attitudes;
- the necessary beats and the frame arrangement;
- where the PR's real names appear in the scene or dialogue;
- the visual style;
- the likely misreading.

Choose in this order:
1. **It makes sense on a cold read.**
2. **It is genuinely funny** to a developer.
3. **It is recognizably this PR**, through words in the scene or dialogue,
   never pointer tags.
4. **Art direction.**

State why the winner beats the other two, and put a concise reason in
`comic.json.designReason`. This reasoning stays local; only compact
categorical creative metadata is posted with the comic. These are editorial
judgments, not a numeric humor score or a rotation quota.

The candidates must differ in premise or storytelling, not just colors or a
new animal species. Glance at the last few `recentComics`: if they were
two-panel before/afters, tell this one as a story. Reusing a style is fine;
reusing either of the last two genres is not, unless the user asked for it.

## Useful starting compositions

- **Setup, build, punchline:** three or four panels in a row, the last one
  landing the joke.
- **Establish, then beats:** a wide top panel over smaller panels (`tiered`).
- **Escalation into a reaction:** small fast panels into one dominant panel
  (`asymmetric`, or a manga page).
- **A pause before the payoff:** a vertical sequence with deliberate space.
- **One visual contradiction:** a single scene with one line of dialogue or a
  caption.
- **Overall context plus details:** a hero panel with contained insets.
- **A contrast that is itself the joke:** two matched frames. Use this
  sparingly.

These are starting points, not a rotation schedule. Use the beats the joke
needs; a large PR does not require a long comic, and a small one can still
deserve four panels.
- Use English left-to-right, top-to-bottom reading order, even for
  manga-inspired art.
- Keep to 1–6 panels and 80 displayed words.
- The metadata title need not be a visible headline, and a visible title need
  not be large or at the top.

Genre archetypes, people, personified objects, creatures and characterless
scenes are all valid. Use the genre's stock characters (a captain, a wizard, a
detective, a monster) when the world carries the joke; personified parts when
the system carries it (the actual hook, server, job or cache, called by its
real name, perhaps as the ship's AI or the dungeon's trap); creatures when
their traits help. Archetypes, never a specific work's characters.

## The final visual check

Before posting, confirm:
- it reads as a drawn comic, not a render or illustration;
- text is readable at PR and phone widths;
- the words belong to the scene;
- the sequencing is unambiguous;
- no outcome is invented;
- there is an actual payoff;
- it points at the change.

Generate one finished image after selection, and redraw only for a concrete
problem or an explicit user reroll. The existing image-route consent applies.

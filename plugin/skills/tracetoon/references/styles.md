# Comic styles

Every comic should look like a drawn comic. Set `"style"` to one of these
ids (it expands to a tested prompt) or name a comic tradition in your own
words ("90s alt-weekly strip", "gag manga with screentone"). Pick what suits
this PR's joke; reusing a recent style is fine. If the user asked for a
specific look or characters, use their words in `"request"` and honor them.

These lettering notes suggest a treatment, not a mandatory headline.
`composition.title` decides whether a title is drawn and where it belongs.

| Style | Look | Family | Good for | Palettes |
|---|---|---|---|---|
| `webcomic` | Modern webcomic | webcomic | gag, relatable, everyday, any | full-color |
| `superhero` | American superhero | american | heroic, rescue, big win, showdown, superhero, kaiju | full-color |
| `silver-age` | Silver Age comic | american | heroic, melodrama, retro, big claim | full-color, limited |
| `alt-comix` | Indie alt-comix | indie | deadpan, awkward, dry humor, existential | limited, bw-accent |
| `shonen-action` | Shonen manga | manga | epic, battle, comeback, speed, rivalry, mecha | bw-accent, full-color |
| `manga-ink` | Seinen manga | manga | tense, mystery, debugging, serious-as-a-joke | bw-accent, limited |
| `shojo` | Shojo manga | manga | dramatic feelings, romance parody, wholesome, devotion | limited, full-color |
| `chibi-anime` | Chibi manga comedy | manga | silly, panic, small fix, cute | full-color, limited |
| `yonkoma` | Yonkoma gag manga | manga | gag, twist, everyday, deadpan | bw-accent, limited |
| `ligne-claire` | Ligne claire | euro | adventure, investigation, clever, travel | full-color |
| `euro-humor` | Franco-Belgian humor | euro | slapstick, chaos, escalation, ensemble | full-color |
| `sunday-strip` | Sunday funnies | newspaper | gag, everyday, relatable, small fix | full-color, limited |
| `editorial-cartoon` | Editorial cartoon | newspaper | commentary, irony, big picture, satire | bw-accent |
| `magazine-cartoon` | Magazine gag cartoon | newspaper | dry wit, understatement, one-liner | bw-accent |
| `webtoon` | Full-color webtoon | webcomic | drama, reaction, slow reveal, vertical | full-color |
| `saturday-cartoon` | 90s Saturday-morning cartoon | american | zany, chaos, slapstick, villain plan | full-color |
| `noir` | Noir graphic novel | american | mystery, debugging, investigation, confession, noir-detective, heist | bw-accent, limited |
| `space-opera` | Space-opera comic | euro | sci-fi, space, epic, space-opera, mission-control | full-color, limited |
| `fantasy-adventure` | Fantasy adventure comic | american | quest, fantasy, dungeon, fantasy-quest, dungeon-crawl | full-color |
| `anime-fantasy` | Fantasy anime | manga | fantasy, isekai, quest, cozy, level up, anime-fantasy | full-color |
| `pixel-16bit` | Pixel comic | webcomic | quest, level up, boss fight, retro, retro-rpg, dungeon-crawl | limited, full-color |

Details (what the image model is asked for):

- **`webcomic`**: modern webcomic, bold clean black ink outlines, bright cel-shaded color, very expressive cartoon faces and big reactions, simple readable backgrounds, crisp panel borders with white gutters. Lettering: bold hand-lettered comic font in white speech balloons, yellow caption boxes, punchy sound effects.
- **`superhero`**: modern American superhero comic book, dynamic foreshortened poses, confident inking with feathered shadows, rich digital coloring, dramatic lighting. Lettering: uppercase comic-book lettering in oval balloons, bold caption boxes, big angular sound effects.
- **`silver-age`**: 1960s American comic book page, Ben-Day halftone dots, bold primary colors, thick inked outlines, melodramatic poses, slightly yellowed newsprint. Lettering: classic uppercase comic lettering in white balloons, exclamation-heavy, narration boxes.
- **`alt-comix`**: indie alternative comic, loose expressive brush ink, slightly wobbly hand-drawn panel borders, flat muted colors, deadpan characters. Lettering: uneven hand-lettered capitals in simple balloons.
- **`shonen-action`**: shonen manga page, energetic black ink, screentone shading, speed lines and impact frames, exaggerated reactions, dynamic camera angles. Lettering: manga balloons with bold lettering, huge hand-drawn sound effects integrated into the art.
- **`manga-ink`**: seinen manga page, detailed black ink linework, crosshatching and screentone, cinematic paneling, restrained, tense expressions. Lettering: clean manga lettering in balloons, sparse narration boxes.
- **`shojo`**: shojo manga page, delicate fine linework, sparkle and flower screentones, big emotive eyes, soft pastel tones, panels that break their borders for emotional beats. Lettering: elegant manga lettering, floating inner-monologue text, sparkly emphasis.
- **`chibi-anime`**: comedic chibi manga, super-deformed characters with big heads, sweat drops, anger marks and comic tears, simple screentone backgrounds, bold ink outlines. Lettering: rounded bubbly balloons, wobbly panic lettering.
- **`yonkoma`**: yonkoma gag manga, clean simple ink linework, cute deformed characters, flat light tones, tidy rectangular panels. Lettering: small neat balloons, a quiet beat before the last-panel punchline.
- **`ligne-claire`**: ligne claire European comic, clean uniform ink outlines, flat bright colors, detailed tidy backgrounds, no hatching. Lettering: neat hand lettering in clean rounded balloons.
- **`euro-humor`**: Franco-Belgian humor comic, round bouncy cartoon characters with big noses, lively brush ink, bright flat colors, busy funny background details. Lettering: lively hand lettering in rounded balloons, onomatopoeia drawn into the scene.
- **`sunday-strip`**: classic Sunday newspaper comic strip, simple expressive cartoon characters, warm flat colors, confident brush outlines, slight newsprint texture. Lettering: friendly hand-lettered balloons.
- **`editorial-cartoon`**: newspaper editorial cartoon, scratchy pen-and-ink crosshatching, exaggerated original figures, words written on the objects that matter, single gray wash. Lettering: hand-lettered words on objects in the scene, a short caption under the drawing.
- **`magazine-cartoon`**: sophisticated magazine gag cartoon, loose confident pen line, light gray wash, understated deadpan characters. Lettering: a single typeset caption beneath the drawing, set in quotes when someone speaks.
- **`webtoon`**: full-color webtoon, clean digital lineart, soft gradient cel shading, glossy modern characters, big reaction close-ups, generous space between panels. Lettering: clean digital balloons, oversized reaction text.
- **`saturday-cartoon`**: 1990s Saturday-morning TV cartoon look drawn as a comic, thick outlines, angular stylized characters, saturated flat colors, squash-and-stretch expressions. Lettering: chunky cartoon lettering in bold balloons, loud sound effects.
- **`noir`**: noir graphic novel, heavy black ink shadows, venetian-blind light, rain, chiaroscuro, trench coats. Lettering: typewriter caption boxes with hard-boiled narration, tight balloons.
- **`space-opera`**: inked European science-fiction comic, clean confident line, bold flat colors, sweeping starships and alien vistas, detailed control panels, cinematic wide shots. Lettering: clean uppercase comic lettering in white balloons, readouts on ship screens, bold sound effects.
- **`fantasy-adventure`**: inked fantasy adventure comic book, heroic poses, castles, dungeons and enchanted forests, rich flat coloring with dramatic torchlight. Lettering: classic comic lettering in balloons, parchment caption boxes, carved-rune signs in the scene.
- **`anime-fantasy`**: full-color fantasy anime key frame, clean cel shading, expressive anime faces with sweat drops, sparkle eyes and comic reaction faces, depth of field: blurred painted backgrounds behind characters in dialogue panels and detailed scenery only in establishing shots, restrained glow that never competes with the lettering. Lettering: clean anime-style balloons, glowing fantasy status windows as captions, hand-drawn sound effects in the art.
- **`pixel-16bit`**: pixel-art comic, crisp 16-bit pixels, clear panel borders, chunky expressive sprites, video-game UI framing. Lettering: pixel-font RPG dialogue boxes.

Palettes: `full-color`; `bw-accent` (black and white with one accent color,
set `"accent"`, e.g. "red"); `duotone` (two inks); `limited` (3 to 4 colors).

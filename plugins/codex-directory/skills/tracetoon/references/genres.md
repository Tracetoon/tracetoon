# Comic genres

Pick the genre **first**, before the joke. `tracetoon prepare` offers three
in `context.comic.genreOptions`: the ones this repo used least recently,
shuffled per branch. Choose the one where this PR's real moment maps most
naturally onto the genre's stakes, set `"genre"` to its id (or a short phrase
of your own for a genre not listed), then find the joke inside that world.
`tracetoon comic check` refuses a genre used by either of the repo's last two
comics, unless the user asked for it (`"request"`) or the repo pins one
(`config genre`).

**Parody the trope, not the property.** Evoke the familiar settings and
character types of a genre's famous works (a cantina of odd aliens, an away
team on a painted planet, a masked dark lord); never name the work or its
characters, and never copy a specific character's design, insignia or ship.

**Your own genres.** Users and repos add genres as genre files, and
`genreOptions` offers them alongside the ones below (an option's `notes` is
extra direction from its author). A genre file is Markdown in
`<config dir>/genres/` (beside Tracetoon's `config.json`) or the repo's
`.github/tracetoon/genres/`; a repo genre replaces a user or built-in one with
the same id. `tracetoon genre list` shows every genre and where it came from;
`tracetoon genre check <file>` validates one:

```markdown
---
id: build-pirates
name: Build pirates
setting: a leaky galleon in a storm of failing builds
archetypes:
  - one-eyed captain
  - parrot that repeats log lines
props:
  - treasure map
  - flag on the mast
jokeHooks:
  - the treasure is a green check
styles:
  - webcomic
---
Optional notes for the comic author.
```

**A persona roster (optional).** A genre file can add a `cast:` list of up to
48 personas, each written `role: name — details` with the role one of hero,
mage, warrior, healer, scout, nemesis or side. The author never sees the whole
roster: each comic's `genreOptions` entry carries a `castOffer` of five,
picked by seed (usually three main-cast roles, a nemesis and a side character;
about one comic in five gets side characters only). Cast from those five and
list their ids in the script's `personas`; `comic check` rejects any other.

## `space-opera`: Space opera

- **Setting:** anywhere a space saga goes: starship decks, docking bays, alien bazaars, strange planets and open space
- **Archetypes:** grizzled starship captain; eager ensign; deadpan ship AI; alien trader; hotshot fighter ace; battle-scarred gunner; masked dark lord
- **Props that carry the PR's words:** bridge viewscreen; red-alert panel; cargo manifest; airlock warning sign; comms hail
- **Joke hooks:** the ship AI takes an order literally; red alert over something tiny; the hull breach is one loose bolt; retries are wave after wave of fighters at the same shield; a race condition is two fighters diving for one docking slot; a cache is a decoy fleet the enemy keeps shooting; a flaky test is a blaster that fires every other pull
- **Styles that suit it:** `space-opera`, `superhero`, `ligne-claire`

## `anime-fantasy`: Anime fantasy

- **Setting:** a sword-and-sorcery world as fantasy anime draws it: guild halls, taverns, roadside campfires, dungeons and glowing gates, witch ateliers, magic academies, market towns, frontier villages and a demon lord's castle
- **Archetypes:** ageless elf mage; chuunibyou mage with one huge spell; gruff dwarf warrior; beast-eared scout; self-important goddess; summoned hero with one cheat skill; guild receptionist; demon lord buried in paperwork
- **Props that carry the PR's words:** floating blue status window; guild quest board; adventurer rank card; appraisal crystal; spell glyph drawn in ink; glowing magic circle; tavern menu board; grimoire page; dungeon gate warning sign; campfire stew pot
- **Joke hooks:** a status window announces a level up for something tiny; a time loop sends the hero back to the last save point; the mage casts one enormous spell a day, then collapses; one stray stroke in a drawn glyph turns the spell into something else; the elf calls a ten-year-old bug recent; the guild clerk rejects the quest form over one missing field
- **Styles that suit it:** `anime-fantasy`, `chibi-anime`, `webtoon`, `shonen-action`
- **Cast:** a roster of 39 personas; each comic is offered five in `castOffer`. Cast from those.

## `cyberpunk`: Cyberpunk

- **Setting:** neon alleys, rain-slick rooftops, back-room netrunner dens
- **Archetypes:** street netrunner; corporate security drone; cybernetic fixer; glitchy vending AI
- **Props that carry the PR's words:** holographic HUD; neon shop sign; jacked-in terminal; ICE firewall readout
- **Joke hooks:** the firewall is one sleepy guard; a heroic hack that is a typo fix; the implant needs a reboot
- **Styles that suit it:** `noir`, `manga-ink`, `webtoon`

## `fantasy-quest`: Fantasy quest

- **Setting:** a road through enchanted woods, a castle gate, a wizard tower
- **Archetypes:** weary wizard; overconfident knight; sly rogue; grumpy dragon
- **Props that carry the PR's words:** quest scroll; spellbook page; carved gate runes; tavern notice board; map with an X
- **Joke hooks:** the prophecy was a config flag; the spell works only when spelled exactly; the dragon hoards cache entries
- **Styles that suit it:** `fantasy-adventure`, `euro-humor`, `shonen-action`

## `dungeon-crawl`: Dungeon crawl

- **Setting:** torchlit dungeon corridors, trapped rooms, a boss chamber
- **Archetypes:** adventuring party; nervous cleric; mimic chest; bored dungeon boss
- **Props that carry the PR's words:** trap warning carved in stone; loot chest label; character sheet; door riddle
- **Joke hooks:** the trap is a missing semicolon; the loot is a green check; the boss is a flaky test
- **Styles that suit it:** `pixel-16bit`, `fantasy-adventure`, `chibi-anime`

## `heist`: Heist caper

- **Setting:** a vault, a casino back office, a getaway van
- **Archetypes:** cool mastermind; twitchy safecracker; tech whiz; oblivious guard
- **Props that carry the PR's words:** vault blueprint; laser-grid panel; crew briefing board; safe dial
- **Joke hooks:** the elaborate plan versus the door that was unlocked; one lookout misses everything; the score is one line
- **Styles that suit it:** `noir`, `silver-age`, `webcomic`

## `kaiju`: Kaiju attack

- **Setting:** a city skyline under attack, a command bunker, a news van
- **Archetypes:** towering kaiju; panicked general; calm scientist; TV news anchor
- **Props that carry the PR's words:** breaking-news ticker; command-bunker map; evacuation sign; scientist clipboard
- **Joke hooks:** the monster is a tiny bug at close range; the army mobilizes for a log warning; the kaiju only wanted a docs fix
- **Styles that suit it:** `superhero`, `manga-ink`, `saturday-cartoon`

## `spy-thriller`: Spy thriller

- **Setting:** a secret lair, a briefing room, a rooftop chase
- **Archetypes:** suave secret agent; gadget quartermaster; monologuing villain; henchman
- **Props that carry the PR's words:** dossier stamped TOP SECRET; gadget tag; self-destruct countdown; decoder screen
- **Joke hooks:** the doomsday device has a flaky test; the gadget does exactly one thing; the villain explains the whole diff
- **Styles that suit it:** `silver-age`, `ligne-claire`, `noir`

## `noir-detective`: Noir detective

- **Setting:** a rain-streaked office, a smoky bar, a crime scene at night
- **Archetypes:** hard-boiled detective; fast-talking informant; nervous witness; tired desk sergeant
- **Props that carry the PR's words:** evidence board with string; case file; office door lettering; chalk outline
- **Joke hooks:** the culprit was the cache all along; the clue is one character; the witness only speaks in logs
- **Styles that suit it:** `noir`, `manga-ink`, `alt-comix`

## `superhero`: Superhero

- **Setting:** city rooftops, a secret base, a villain lair
- **Archetypes:** caped hero; sidekick; scenery-chewing villain; citizen in peril
- **Props that carry the PR's words:** villain blueprint; base computer screen; newspaper front page; hero signal in the sky
- **Joke hooks:** the superpower is reading the error message; a team-up between two tools; the villain is technical debt
- **Styles that suit it:** `superhero`, `silver-age`, `webcomic`

## `mecha`: Giant robot

- **Setting:** a mech hangar, a cockpit, a city-scale battlefield
- **Archetypes:** hotshot pilot; tired hangar mechanic; commander on the radio; rival mech
- **Props that carry the PR's words:** cockpit HUD; hangar status board; launch countdown; maintenance checklist
- **Joke hooks:** the ultimate attack needs one flag; the mech will not launch until lint passes; pilot and mechanic argue over a bolt
- **Styles that suit it:** `shonen-action`, `manga-ink`, `space-opera`

## `post-apocalyptic`: Wasteland

- **Setting:** a desert wasteland, a scrap fort, a convoy on a broken highway
- **Archetypes:** road warrior; scrap tinkerer; wasteland trader; feral robot
- **Props that carry the PR's words:** scrawled road sign; barter board; salvage crate stencil; radio scanner
- **Joke hooks:** the last working build is guarded like water; a relic from the old world is a README; trading for one passing test
- **Styles that suit it:** `alt-comix`, `superhero`, `noir`

## `haunted-house`: Haunted house

- **Setting:** a creaky mansion, a candlelit hallway, an attic full of trunks
- **Archetypes:** skeptical investigator; polite ghost; nervous intern with a flashlight; creepy butler
- **Props that carry the PR's words:** Ouija board; portrait with moving eyes; warning scrawled on the wall; spirit-meter readout
- **Joke hooks:** the haunting is a stale process; the ghost only wants its edit kept; a curse that is a timezone bug
- **Styles that suit it:** `alt-comix`, `webtoon`, `saturday-cartoon`

## `pirates`: High-seas pirates

- **Setting:** a pirate ship deck, a treasure island, a port tavern
- **Archetypes:** swaggering captain; superstitious first mate; parrot; navy officer
- **Props that carry the PR's words:** treasure map; wanted poster; ship's log; message in a bottle
- **Joke hooks:** the treasure is a merged PR; the map leads to the wrong branch; mutiny over a renamed file
- **Styles that suit it:** `euro-humor`, `webcomic`, `silver-age`

## `retro-rpg`: Retro video game

- **Setting:** an 8/16-bit game world: overworld map, shop, boss arena
- **Archetypes:** pixel hero; cryptic NPC; shopkeeper; final boss
- **Props that carry the PR's words:** RPG dialogue box; HP bar; level-up banner; save-point sign; item description
- **Joke hooks:** grinding XP is rerunning tests; the NPC repeats one line forever; the boss has one weak point
- **Styles that suit it:** `pixel-16bit`, `chibi-anime`, `webcomic`

## `mission-control`: Mission control

- **Setting:** a launch control room, a rocket on the pad, a capsule in orbit
- **Archetypes:** flight director; console operator; astronaut; nervous engineer
- **Props that carry the PR's words:** mission big board; go/no-go checklist; launch countdown clock; telemetry screen
- **Joke hooks:** a go/no-go poll where one console says no; abort over one red light; houston, we have a lint warning
- **Styles that suit it:** `ligne-claire`, `silver-age`, `space-opera`

## `time-travel`: Time travel

- **Setting:** a time machine lab, the past, an alternate future
- **Archetypes:** frazzled inventor; future self; confused historical bystander; time cop
- **Props that carry the PR's words:** time-machine dial; newspaper from the future; paradox warning light; lab whiteboard
- **Joke hooks:** going back to stop the bad commit; the future self says just read the logs; a paradox caused by a rebase
- **Styles that suit it:** `webcomic`, `saturday-cartoon`, `euro-humor`

## `wild-west`: Wild West

- **Setting:** a dusty frontier town, a saloon, a train robbery
- **Archetypes:** laconic sheriff; outlaw; saloon keeper; nervous telegraph operator
- **Props that carry the PR's words:** wanted poster; saloon sign; telegraph message; sheriff badge
- **Joke hooks:** a showdown with a flaky test at high noon; this town is not big enough for two configs; the outlaw is a hidden dependency
- **Styles that suit it:** `euro-humor`, `silver-age`, `sunday-strip`

## `everyday`: Everyday life

- **Setting:** an office, a kitchen, a commute, a home desk
- **Archetypes:** tired developer; chipper coworker; personified tool
- **Props that carry the PR's words:** sticky note; mug; door sign; terminal screen; box stamp
- **Joke hooks:** the tool behaves like a stubborn coworker; a huge hunt ends at one line
- **Styles that suit it:** `webcomic`, `sunday-strip`, `yonkoma`

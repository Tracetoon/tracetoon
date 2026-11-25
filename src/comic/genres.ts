/**
 * Comic genres: the world a comic is set in, chosen before the joke. Each is a
 * genre many works share, so it can be drawn as a class (a starship captain,
 * a wizard, a hard-boiled detective) without copying any one work. The PR's
 * real moment is then told inside it. Genres rotate: the least recently used
 * are offered first, so a repo's comics don't all land in the same office.
 */
import { createHash } from 'node:crypto';
import { castOffer, diverseHint, parseCastEntry, withRequired, type CastOffer, type CastPersona } from './casting.ts';
import animeFantasyCast from './cast/anime-fantasy.json' with { type: 'json' };
import spaceOperaCast from './cast/space-opera.json' with { type: 'json' };
import { BUILT_IN_MEMES, memeOffer, stylePick, type Meme } from './memes.ts';

export interface Genre {
  id: string;
  name: string;
  /** Where it happens. */
  setting: string;
  /** Stock character classes: archetypes, never a specific work's characters. */
  archetypes: string[];
  /** Surfaces in the scene that can carry the PR's real words. */
  props: string[];
  /** Genre beats that map well onto software moments. */
  jokeHooks: string[];
  /** Style ids (styles.ts) that suit it. */
  styles: string[];
  /** Extra direction for the comic author, from a genre file's body. */
  notes?: string;
  /**
   * A persona roster (casting.ts). When present the author is never shown it
   * whole: each comic is offered five personas picked by seed.
   */
  cast?: CastPersona[];
  /**
   * Diverse archetypes from the genre's own source works. About one comic in
   * five must cast one (casting.ts diverseHint).
   */
  diverseCast?: CastPersona[];
  /** Famous scenes, lines and tropes of the genre; each comic is offered three (memes.ts). */
  memes?: Meme[];
  /** Style weights; when present the host assigns each comic's style from them. */
  styleMix?: Record<string, number>;
  /** Where it came from: shipped with Tracetoon, the user's genres folder, or the repo's. */
  source?: 'built-in' | 'user' | 'repo';
  /** The genre file it was read from (user and repo genres). */
  path?: string;
}

export const EVERYDAY = 'everyday';

const BUILT_IN_GENRES: Genre[] = [
  {
    id: 'space-opera',
    name: 'Space opera',
    setting: 'anywhere a space saga goes: starship decks, docking bays, alien bazaars, strange planets and open space',
    archetypes: [
      'grizzled starship captain',
      'eager ensign',
      'deadpan ship AI',
      'alien trader',
      'hotshot fighter ace',
      'battle-scarred gunner',
      'masked dark lord',
    ],
    props: ['bridge viewscreen', 'red-alert panel', 'cargo manifest', 'airlock warning sign', 'comms hail'],
    jokeHooks: [
      'the ship AI takes an order literally',
      'red alert over something tiny',
      'the hull breach is one loose bolt',
      'retries are wave after wave of fighters at the same shield',
      'a race condition is two fighters diving for one docking slot',
      'a cache is a decoy fleet the enemy keeps shooting',
      'a flaky test is a blaster that fires every other pull',
    ],
    styles: ['space-opera', 'superhero', 'ligne-claire'],
    notes:
      'Comic combat is welcome and nobody gets hurt: blaster bolts that miss, glowing-sword duels, fighter dogfights, a whole fleet in formation. Style people as the genre’s source works do: uniforms, flight suits and spacer gear, with crews as varied as the great space sagas.',
  },
  {
    id: 'anime-fantasy',
    name: 'Anime fantasy',
    setting:
      'a sword-and-sorcery world as fantasy anime draws it: guild halls, taverns, roadside campfires, dungeons and glowing gates, witch ateliers, magic academies, market towns, frontier villages and a demon lord\'s castle',
    archetypes: [
      'ageless elf mage',
      'chuunibyou mage with one huge spell',
      'gruff dwarf warrior',
      'beast-eared scout',
      'self-important goddess',
      'summoned hero with one cheat skill',
      'guild receptionist',
      'demon lord buried in paperwork',
    ],
    props: [
      'floating blue status window',
      'guild quest board',
      'adventurer rank card',
      'appraisal crystal',
      'spell glyph drawn in ink',
      'glowing magic circle',
      'tavern menu board',
      'grimoire page',
      'dungeon gate warning sign',
      'campfire stew pot',
    ],
    jokeHooks: [
      'a status window announces a level up for something tiny',
      'a time loop sends the hero back to the last save point',
      'the mage casts one enormous spell a day, then collapses',
      'one stray stroke in a drawn glyph turns the spell into something else',
      'the elf calls a ten-year-old bug recent',
      'the guild clerk rejects the quest form over one missing field',
    ],
    styles: [
      'anime-fantasy',
      'chibi-anime',
      'webtoon',
      'shonen-action',
    ],
    notes: [
      'Draw it as full-colour fantasy anime by default: clean cel shading, painted skies, glowing spells, sweat drops, sparkle eyes and comic reaction faces. Now and then a black-and-white manga page with screentone suits a tense or battle beat.',
      'The party is the heart of it, and its members are often funnier than the hero: let one of them carry the joke while the hero plays it straight. Cast from the personas offered for this comic; ones whose quirks clash make the best pairs.',
      'Places to choose from, and vary: a guild counter with a queue of adventurers, a rowdy tavern at night, a campfire on the road under the stars, a torchlit dungeon or a glowing gate, a witch\'s atelier full of ink and glass, a magic-academy exam hall, a market-town square, a frontier farming village, a hot-spring inn, a floating library, a flower field, a snowbound mountain pass, the demon lord\'s throne room, an inn room after the quest.',
      'Battles are comic and bloodless: fireballs that fizzle, a giant spell that flattens a hill, a whole party against one slime. A time loop is a reset to the save point, never a death. Outfits stay practical, with no fan service. Beastfolk are party members, never servants or captives, and fantasy races are never stand-ins for real-world peoples. The summoned hero comes from our world, so anyone can fill that role. Style people as the genre’s source works do: elves, dark elves, dwarves, beastfolk and humans of every complexion, in the genre’s own costumes.',
    ].join('\n\n'),
    // The author never sees this whole roster: each comic is offered five (casting.ts castOffer).
    cast: castRoster([
      'hero: a summoned hero with one odd cheat skill — arrived from our world with one strange power (perfect turnip appraisal, talking to doors) that is useless until exactly the right moment',
      'hero: an overpowered newcomer — flattens the boss by accident, then asks "did I overdo it?" while the guild staff stare',
      'hero: a vain hero — poses for a statue in every town and gives speeches mid-battle, but is secretly kind',
      'hero: a time-loop hero — wakes at the last save point after every failure, remembers each attempt and is very tired of this one',
      'mage: an ageless elf mage — calm and sleepy, collects useless spells (one polishes buckles), calls ten years ago "recently" and always opens the mimic chest',
      'mage: a chuunibyou mage — eyepatch, cape and a long dramatic incantation for one enormous spell a day, then face-plants out of mana',
      'mage: a deadpan apprentice mage — flat stare, flawless technique, quietly scolds their own master and keeps the party\'s budget',
      'mage: a fussy scholar mage — book-smart, horrified by monster food, explains the theory while the spell fizzles',
      'mage: an apprentice witch who draws spells — inks magic glyphs with a pen; one stray stroke turns the spell into something else',
      'warrior: a knight who leaps into every hit — gleeful tank in heavy plate who begs to be the target and never lands a swing',
      'warrior: a huge cowardly warrior — towering and scarred, terrified of everything right up until it counts',
      'warrior: a silent armoured veteran — never takes the helmet off, answers in one word, knows exactly one monster\'s weak spot',
      'warrior: a gruff dwarf warrior — beard, axe and ale; bickers with any elf in reach and rates every wall by its stonework',
      'warrior: a dwarf who cooks monsters — practical and unbothered, turns every defeated monster into a balanced meal in a portable pot',
      'healer: a self-important goddess — glowing robes, demands worship, wails when a plan fails, heals best when nobody is watching',
      'healer: a drunk priest — a flask in one hand and a holy book in the other, wiser than they look, right advice at the wrong time',
      'healer: the only sane healer — staff and kind eyes, permanently exasperated, the one who reads the quest\'s fine print',
      'scout: a beast-eared scout — cat, wolf or rabbit ears and a tail that give away every feeling; a sharp nose and always hungry',
      'scout: a grumpy halfling lockpicker — the oldest pro in the room, picks any lock and complains about everyone\'s footwork',
      'scout: a fox-spirit trickster — several tails and illusion tricks, answers questions with riddles, steals the last dumpling',
      'nemesis: a demon lord buried in paperwork — horns, cape and a throne piled with forms; would surrender if it meant less admin',
      'nemesis: a hoarding dragon — counts every coin twice and is furious over a single rounding error',
      'nemesis: a mimic chest — has fooled this party before and is smug about it',
      'nemesis: a lich who keeps backups — a skeletal sorcerer with spare souls hidden everywhere, very calm about being destroyed',
      'nemesis: a rival party — shinier armour, always arrives first and posts every clear on the guild board',
      'nemesis: a slime horde — dozens of wobbling slimes; each is harmless, together they flood the dungeon',
      'nemesis: a dark-knight general — imposing armour and a grand monologue, keeps losing to the weakest party member',
      'nemesis: a giant beast at the gate — sleeps across the dungeon entrance and nobody wants to be the one to wake it',
      'side: a guild receptionist — a cheerful smile, a stamp and a stack of forms; rejects quests over one missing field',
      'side: an innkeeper — has seen every party fail, keeps a tab and knows every rumour',
      'side: a blacksmith — judges your sword at a glance, fixes it with one tap and a long lecture',
      'side: a travelling merchant — a cart of suspicious bargains; every deal has a catch in the small print',
      'side: a strict witch teacher — tall pointed hat and long robe, spots a mistake in a glyph from across the room',
      'side: a tavern bard — lute and flourishes, rewrites the party\'s defeats as glorious victories',
      'side: a village elder — delivers a vague prophecy and quietly revises it afterwards',
      'side: a talking sword — sarcastic and opinionated, but can\'t swing itself',
      'side: a friendly slime — round and bouncy, absorbs anything, including the evidence',
      'side: a dragon in human form — horns, a tail and an endless appetite; eats the whole tavern menu',
      'side: a polite skeleton lord — a courteous undead noble whose over-devoted servants misread every order',
    ]),
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    setting: 'neon alleys, rain-slick rooftops, back-room netrunner dens',
    archetypes: ['street netrunner', 'corporate security drone', 'cybernetic fixer', 'glitchy vending AI'],
    props: ['holographic HUD', 'neon shop sign', 'jacked-in terminal', 'ICE firewall readout'],
    jokeHooks: ['the firewall is one sleepy guard', 'a heroic hack that is a typo fix', 'the implant needs a reboot'],
    styles: ['noir', 'manga-ink', 'webtoon'],
  },
  {
    id: 'fantasy-quest',
    name: 'Fantasy quest',
    setting: 'a road through enchanted woods, a castle gate, a wizard tower',
    archetypes: ['weary wizard', 'overconfident knight', 'sly rogue', 'grumpy dragon'],
    props: ['quest scroll', 'spellbook page', 'carved gate runes', 'tavern notice board', 'map with an X'],
    jokeHooks: ['the prophecy was a config flag', 'the spell works only when spelled exactly', 'the dragon hoards cache entries'],
    styles: ['fantasy-adventure', 'euro-humor', 'shonen-action'],
  },
  {
    id: 'dungeon-crawl',
    name: 'Dungeon crawl',
    setting: 'torchlit dungeon corridors, trapped rooms, a boss chamber',
    archetypes: ['adventuring party', 'nervous cleric', 'mimic chest', 'bored dungeon boss'],
    props: ['trap warning carved in stone', 'loot chest label', 'character sheet', 'door riddle'],
    jokeHooks: ['the trap is a missing semicolon', 'the loot is a green check', 'the boss is a flaky test'],
    styles: ['pixel-16bit', 'fantasy-adventure', 'chibi-anime'],
  },
  {
    id: 'heist',
    name: 'Heist caper',
    setting: 'a vault, a casino back office, a getaway van',
    archetypes: ['cool mastermind', 'twitchy safecracker', 'tech whiz', 'oblivious guard'],
    props: ['vault blueprint', 'laser-grid panel', 'crew briefing board', 'safe dial'],
    jokeHooks: ['the elaborate plan versus the door that was unlocked', 'one lookout misses everything', 'the score is one line'],
    styles: ['noir', 'silver-age', 'webcomic'],
  },
  {
    id: 'kaiju',
    name: 'Kaiju attack',
    setting: 'a city skyline under attack, a command bunker, a news van',
    archetypes: ['towering kaiju', 'panicked general', 'calm scientist', 'TV news anchor'],
    props: ['breaking-news ticker', 'command-bunker map', 'evacuation sign', 'scientist clipboard'],
    jokeHooks: ['the monster is a tiny bug at close range', 'the army mobilizes for a log warning', 'the kaiju only wanted a docs fix'],
    styles: ['superhero', 'manga-ink', 'saturday-cartoon'],
  },
  {
    id: 'spy-thriller',
    name: 'Spy thriller',
    setting: 'a secret lair, a briefing room, a rooftop chase',
    archetypes: ['suave secret agent', 'gadget quartermaster', 'monologuing villain', 'henchman'],
    props: ['dossier stamped TOP SECRET', 'gadget tag', 'self-destruct countdown', 'decoder screen'],
    jokeHooks: ['the doomsday device has a flaky test', 'the gadget does exactly one thing', 'the villain explains the whole diff'],
    styles: ['silver-age', 'ligne-claire', 'noir'],
  },
  {
    id: 'noir-detective',
    name: 'Noir detective',
    setting: 'a rain-streaked office, a smoky bar, a crime scene at night',
    archetypes: ['hard-boiled detective', 'fast-talking informant', 'nervous witness', 'tired desk sergeant'],
    props: ['evidence board with string', 'case file', 'office door lettering', 'chalk outline'],
    jokeHooks: ['the culprit was the cache all along', 'the clue is one character', 'the witness only speaks in logs'],
    styles: ['noir', 'manga-ink', 'alt-comix'],
  },
  {
    id: 'superhero',
    name: 'Superhero',
    setting: 'city rooftops, a secret base, a villain lair',
    archetypes: ['caped hero', 'sidekick', 'scenery-chewing villain', 'citizen in peril'],
    props: ['villain blueprint', 'base computer screen', 'newspaper front page', 'hero signal in the sky'],
    jokeHooks: ['the superpower is reading the error message', 'a team-up between two tools', 'the villain is technical debt'],
    styles: ['superhero', 'silver-age', 'webcomic'],
  },
  {
    id: 'mecha',
    name: 'Giant robot',
    setting: 'a mech hangar, a cockpit, a city-scale battlefield',
    archetypes: ['hotshot pilot', 'tired hangar mechanic', 'commander on the radio', 'rival mech'],
    props: ['cockpit HUD', 'hangar status board', 'launch countdown', 'maintenance checklist'],
    jokeHooks: ['the ultimate attack needs one flag', 'the mech will not launch until lint passes', 'pilot and mechanic argue over a bolt'],
    styles: ['shonen-action', 'manga-ink', 'space-opera'],
  },
  {
    id: 'post-apocalyptic',
    name: 'Wasteland',
    setting: 'a desert wasteland, a scrap fort, a convoy on a broken highway',
    archetypes: ['road warrior', 'scrap tinkerer', 'wasteland trader', 'feral robot'],
    props: ['scrawled road sign', 'barter board', 'salvage crate stencil', 'radio scanner'],
    jokeHooks: ['the last working build is guarded like water', 'a relic from the old world is a README', 'trading for one passing test'],
    styles: ['alt-comix', 'superhero', 'noir'],
  },
  {
    id: 'haunted-house',
    name: 'Haunted house',
    setting: 'a creaky mansion, a candlelit hallway, an attic full of trunks',
    archetypes: ['skeptical investigator', 'polite ghost', 'nervous intern with a flashlight', 'creepy butler'],
    props: ['Ouija board', 'portrait with moving eyes', 'warning scrawled on the wall', 'spirit-meter readout'],
    jokeHooks: ['the haunting is a stale process', 'the ghost only wants its edit kept', 'a curse that is a timezone bug'],
    styles: ['alt-comix', 'webtoon', 'saturday-cartoon'],
  },
  {
    id: 'pirates',
    name: 'High-seas pirates',
    setting: 'a pirate ship deck, a treasure island, a port tavern',
    archetypes: ['swaggering captain', 'superstitious first mate', 'parrot', 'navy officer'],
    props: ['treasure map', 'wanted poster', "ship's log", 'message in a bottle'],
    jokeHooks: ['the treasure is a merged PR', 'the map leads to the wrong branch', 'mutiny over a renamed file'],
    styles: ['euro-humor', 'webcomic', 'silver-age'],
  },
  {
    id: 'retro-rpg',
    name: 'Retro video game',
    setting: 'an 8/16-bit game world: overworld map, shop, boss arena',
    archetypes: ['pixel hero', 'cryptic NPC', 'shopkeeper', 'final boss'],
    props: ['RPG dialogue box', 'HP bar', 'level-up banner', 'save-point sign', 'item description'],
    jokeHooks: ['grinding XP is rerunning tests', 'the NPC repeats one line forever', 'the boss has one weak point'],
    styles: ['pixel-16bit', 'chibi-anime', 'webcomic'],
  },
  {
    id: 'mission-control',
    name: 'Mission control',
    setting: 'a launch control room, a rocket on the pad, a capsule in orbit',
    archetypes: ['flight director', 'console operator', 'astronaut', 'nervous engineer'],
    props: ['mission big board', 'go/no-go checklist', 'launch countdown clock', 'telemetry screen'],
    jokeHooks: ['a go/no-go poll where one console says no', 'abort over one red light', 'houston, we have a lint warning'],
    styles: ['ligne-claire', 'silver-age', 'space-opera'],
  },
  {
    id: 'time-travel',
    name: 'Time travel',
    setting: 'a time machine lab, the past, an alternate future',
    archetypes: ['frazzled inventor', 'future self', 'confused historical bystander', 'time cop'],
    props: ['time-machine dial', 'newspaper from the future', 'paradox warning light', 'lab whiteboard'],
    jokeHooks: ['going back to stop the bad commit', 'the future self says just read the logs', 'a paradox caused by a rebase'],
    styles: ['webcomic', 'saturday-cartoon', 'euro-humor'],
  },
  {
    id: 'wild-west',
    name: 'Wild West',
    setting: 'a dusty frontier town, a saloon, a train robbery',
    archetypes: ['laconic sheriff', 'outlaw', 'saloon keeper', 'nervous telegraph operator'],
    props: ['wanted poster', 'saloon sign', 'telegraph message', 'sheriff badge'],
    jokeHooks: ['a showdown with a flaky test at high noon', 'this town is not big enough for two configs', 'the outlaw is a hidden dependency'],
    styles: ['euro-humor', 'silver-age', 'sunday-strip'],
  },
  {
    id: EVERYDAY,
    name: 'Everyday life',
    setting: 'an office, a kitchen, a commute, a home desk',
    archetypes: ['tired developer', 'chipper coworker', 'personified tool'],
    props: ['sticky note', 'mug', 'door sign', 'terminal screen', 'box stamp'],
    jokeHooks: ['the tool behaves like a stubborn coworker', 'a huge hunt ends at one line'],
    styles: ['webcomic', 'sunday-strip', 'yonkoma'],
  },
];

/** Anime fantasy is mostly full-color anime, with a manga page about one comic in six. */
/** Built-in diverse archetypes: `{ role, name, details }` from the genre's source works. */
const diverseRoster = (raw: { role: string; name: string; details: string }[]): CastPersona[] =>
  raw.map((r) => {
    const p = parseCastEntry(`${r.role}: ${r.name} — ${r.details}`, { anyRole: true });
    if (!p) throw new Error(`bad diverse archetype: ${r.name}`);
    return p;
  });
const DIVERSE_CASTS: Record<string, CastPersona[]> = {
  'anime-fantasy': diverseRoster(animeFantasyCast),
  'space-opera': diverseRoster(spaceOperaCast),
};

const STYLE_MIXES: Record<string, Record<string, number>> = {
  'anime-fantasy': { 'anime-fantasy': 7, 'chibi-anime': 2, webtoon: 1, 'shonen-action': 2 },
};

export const GENRES: Genre[] = BUILT_IN_GENRES.map((g) => ({
  ...g,
  ...(BUILT_IN_MEMES[g.id]?.length ? { memes: BUILT_IN_MEMES[g.id] } : {}),
  ...(STYLE_MIXES[g.id] ? { styleMix: STYLE_MIXES[g.id] } : {}),
  ...(DIVERSE_CASTS[g.id]?.length ? { diverseCast: DIVERSE_CASTS[g.id] } : {}),
}));

export const MAX_GENRE_CHARS = 40;

export const genreById = (id: string | undefined, catalog: Genre[] = GENRES) =>
  id ? catalog.find((g) => g.id === id.trim().toLowerCase()) : undefined;

/** A genre's identity for repeat checks: its id, or the custom phrase lowercased. */
export const genreKey = (g: string) => (genreById(g)?.id ?? g.trim().toLowerCase());

/**
 * Genres to offer, least recently used first. Never-used genres come first in
 * an order shuffled by `seed` (the branch and repo), so different PRs get
 * different suggestions even offline. `everyday` goes last among the unused.
 * Used genres follow, oldest use first.
 */
export function freshGenres(
  recent: string[] = [],
  seed = '',
  catalog: Genre[] = GENRES,
): Genre[] {
  const used = recent.map(genreKey);
  const rank = (g: Genre) =>
    createHash('sha256').update(`${seed}\0${g.id}`).digest().readUInt32BE(0);
  const unused = catalog.filter((g) => !used.includes(g.id)).sort((a, b) =>
    a.id === EVERYDAY ? 1 : b.id === EVERYDAY ? -1 : rank(a) - rank(b),
  );
  const usedOldestFirst = catalog.filter((g) => used.includes(g.id)).sort(
    (a, b) => used.indexOf(b.id) - used.indexOf(a.id),
  );
  return [...unused, ...usedOldestFirst];
}

export interface GenreOption {
  id: string;
  name: string;
  setting: string;
  archetypes: string[];
  props: string[];
  jokeHooks: string[];
  /** A user or repo genre's extra direction for the author. */
  notes?: string;
  /** The five personas this comic casts from, when the genre has a roster. */
  castOffer?: CastOffer;
  /** Three genre memes this comic may use, when the genre has a pool. */
  memeOffer?: Meme[];
  /** The style the host assigned this comic, when the genre has a style mix. */
  assignedStyle?: string;
  /** A diverse archetype this comic must cast, for a genre without a cast offer. */
  requiredCast?: CastPersona;
}

const option = (
  { id, name, setting, archetypes, props, jokeHooks, notes, cast, memes, styleMix, diverseCast }: Genre,
  seed = '',
  recentMemes: string[] = [],
): GenreOption => {
  const hint = diverseHint(diverseCast, `${seed}\0${id}`);
  const plain = castOffer(cast, `${seed}\0${id}`);
  const offer = plain && hint ? withRequired(plain, hint) : plain;
  const memePicks = memeOffer(memes, `${seed}\0${id}`, {
    recent: recentMemes,
    ...(offer ? { roles: [...new Set(offer.personas.map((p) => p.role))] } : {}),
  });
  const style = stylePick(styleMix, `${seed}\0${id}`);
  return {
    id,
    name,
    setting,
    // With an offer the author sees only the offered personas, not the roster.
    archetypes: offer ? offer.personas.map((p) => p.name) : archetypes,
    props,
    jokeHooks,
    ...(notes ? { notes } : {}),
    ...(offer ? { castOffer: offer } : {}),
    ...(memePicks ? { memeOffer: memePicks } : {}),
    ...(style ? { assignedStyle: style } : {}),
    ...(hint && !offer ? { requiredCast: hint } : {}),
  };
};

/** Roster entries written as `role: name — details`, parsed; malformed entries throw. */
export function castRoster(entries: string[]): CastPersona[] {
  return entries.map((e) => {
    const p = parseCastEntry(e);
    if (!p) throw new Error(`bad cast entry: ${e}`);
    return p;
  });
}

/**
 * What the agent is offered in context.json: the top few fresh genres with
 * their material, or only the repo's pinned genre.
 */
export function genreOptions(
  recent: string[],
  opts: { seed?: string; pinned?: string; count?: number; catalog?: Genre[]; recentMemes?: string[] } = {},
): GenreOption[] {
  if (opts.pinned) {
    const g = genreById(opts.pinned, opts.catalog);
    return [
      g
        ? option(g, opts.seed, opts.recentMemes)
        : { id: opts.pinned, name: opts.pinned, setting: '', archetypes: [], props: [], jokeHooks: [] },
    ];
  }
  return freshGenres(recent, opts.seed, opts.catalog).slice(0, opts.count ?? 3).map((g) => option(g, opts.seed, opts.recentMemes));
}

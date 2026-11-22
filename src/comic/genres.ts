/**
 * Comic genres: the world a comic is set in, chosen before the joke. Each is a
 * genre many works share, so it can be drawn as a class (a starship captain,
 * a wizard, a hard-boiled detective) without copying any one work. The PR's
 * real moment is then told inside it. Genres rotate: the least recently used
 * are offered first, so a repo's comics don't all land in the same office.
 */
import { createHash } from 'node:crypto';

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
  /** Where it came from: shipped with Tracetoon, the user's genres folder, or the repo's. */
  source?: 'built-in' | 'user' | 'repo';
  /** The genre file it was read from (user and repo genres). */
  path?: string;
}

export const EVERYDAY = 'everyday';

export const GENRES: Genre[] = [
  {
    id: 'space-opera',
    name: 'Space opera',
    setting: 'a starship bridge, docking bays, cargo holds and alien bazaars',
    archetypes: ['grizzled starship captain', 'eager ensign', 'deadpan ship AI', 'alien trader'],
    props: ['bridge viewscreen', 'red-alert panel', 'cargo manifest', 'airlock warning sign', 'comms hail'],
    jokeHooks: ['the ship AI takes an order literally', 'red alert over something tiny', 'the hull breach is one loose bolt'],
    styles: ['space-opera', 'superhero', 'ligne-claire'],
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
}

const option = ({ id, name, setting, archetypes, props, jokeHooks, notes }: Genre): GenreOption => ({
  id,
  name,
  setting,
  archetypes,
  props,
  jokeHooks,
  ...(notes ? { notes } : {}),
});

/**
 * What the agent is offered in context.json: the top few fresh genres with
 * their material, or only the repo's pinned genre.
 */
export function genreOptions(
  recent: string[],
  opts: { seed?: string; pinned?: string; count?: number; catalog?: Genre[] } = {},
): GenreOption[] {
  if (opts.pinned) {
    const g = genreById(opts.pinned, opts.catalog);
    return [
      g
        ? option(g)
        : { id: opts.pinned, name: opts.pinned, setting: '', archetypes: [], props: [], jokeHooks: [] },
    ];
  }
  return freshGenres(recent, opts.seed, opts.catalog).slice(0, opts.count ?? 3).map(option);
}

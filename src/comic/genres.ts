/**
 * Comic genres: the world a comic is set in, chosen before the joke. Each is a
 * genre many works share, so it can be drawn as a class (a starship captain,
 * a wizard, a hard-boiled detective) without copying any one work. The PR's
 * real moment is then told inside it. Genres rotate: the least recently used
 * are offered first, so a repo's comics don't all land in the same office.
 */
import { createHash } from 'node:crypto';
import { isekaiCast, type IsekaiPacketCast } from './isekai/casting.ts';
import type { ComicSummary } from './types.ts';
import { layoutPick } from './layouts.ts';
import { cooldownFrom, drawPitches, memeChoices, tropeOffer, type AnimeMeme, type Cooldown, type GagPick, type Pitch, type TropeOffer } from './isekai/pitches.ts';
import { castOffer, diverseHint, leadPick, parseCastEntry, withLead, withRequired, type CastOffer, type CastPersona } from './casting.ts';
import spaceOperaLeads from './cast/space-opera-leads.json' with { type: 'json' };
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
  /**
   * Main characters, each modelled on a real series' protagonist; the role is
   * its diversity axis (stereotype, gender, orientation or race). Every comic
   * gets one (casting.ts leadPick).
   */
  leads?: CastPersona[];
  /** Famous scenes, lines and tropes of the genre; each comic is offered three (memes.ts). */
  memes?: Meme[];
  /** Style weights; when present the host assigns each comic's style from them. */
  styleMix?: Record<string, number>;
  /** Cast each comic from the isekai archetype guide (isekai/casting.ts). */
  isekai?: boolean;
  /** false: an isekai comic is written directly, without the pitches, ideas and judge. */
  brainstorm?: boolean;
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
    setting: 'an original sword-and-sorcery other world, drawn as fantasy and isekai anime',
    // The cast comes from the isekai archetype guide (isekai/casting.ts), one generated cast per comic.
    archetypes: ['isekai protagonists, companions and world characters from the archetype guide'],
    props: ['floating status window', 'guild quest board', 'adventurer rank card', 'spell circle', 'tavern menu board'],
    jokeHooks: [],
    styles: ['anime-fantasy'],
    isekai: true,
    // Shelved after rounds 14–16 lost to round 12: comics are written directly. A genre file's `brainstorm: on` brings it back.
    brainstorm: false,
    notes: [
      'Each character is a story role plus a visible silhouette plus a capability plus a behavioral contradiction; the joke is the contradiction inside genuine competence.',
      'Species is shared visual vocabulary, never a personality; nobody is only an admirer of the hero; romance stays off.',
      'Beastfolk and other peoples are companions, never servants or captives. Outfits stay practical, with no fan service. A time loop is a reset, never a death.',
    ].join(' '),
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
  'space-opera': diverseRoster(spaceOperaCast),
};

/** Built-in leads: `{ axis, name, details }`, the axis kept as the role. */
const leadRoster = (raw: { axis: string; name: string; details: string }[]): CastPersona[] =>
  diverseRoster(raw.map((r) => ({ role: r.axis, name: r.name, details: r.details })));
const LEADS: Record<string, CastPersona[]> = {
  'space-opera': leadRoster(spaceOperaLeads),
};


/** Style mixes by genre (anime fantasy's was shelved in round 12). */
const STYLE_MIXES: Record<string, Record<string, number>> = {};

export const GENRES: Genre[] = BUILT_IN_GENRES.map((g) => ({
  ...g,
  ...(BUILT_IN_MEMES[g.id]?.length ? { memes: BUILT_IN_MEMES[g.id] } : {}),
  ...(STYLE_MIXES[g.id] ? { styleMix: STYLE_MIXES[g.id] } : {}),
  ...(DIVERSE_CASTS[g.id]?.length ? { diverseCast: DIVERSE_CASTS[g.id] } : {}),
  ...(LEADS[g.id]?.length ? { leads: LEADS[g.id] } : {}),
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
  /** The tiled structure the host assigned this comic for each panel count (layouts.ts): {"3": "rows:1-2", ...}. */
  assignedLayout?: Record<string, string>;
  /** A diverse archetype this comic must cast, for a genre without a cast offer. */
  requiredCast?: CastPersona;
  /** This comic's main character, for a genre without a cast offer (with one, it is in the offer). */
  lead?: CastPersona;
  /** The cast generated from the isekai archetype guide for this comic. */
  isekaiCast?: IsekaiPacketCast;
  /** Three pitches drawn at random for this isekai cast: a scenario without its punchline, and who plays it. */
  pitches?: Pitch[];
  /** The memes this isekai comic may attach to a gag where one fits (not used in the last 100 comics). */
  memeList?: AnimeMeme[];
  /** Three isekai staples or memes this comic may build on, optionally (isekai/pitches.ts tropeOffer). */
  tropeOffer?: TropeOffer[];
  /** The gag the judge scored best, once picked (`tracetoon comic gags`). */
  pick?: GagPick;
}

/** How many casts to try before giving up on a lead who isn't on cooldown. */
const LEAD_TRIES = 20;

/** An isekai cast whose lead wasn't on the page in the last few comics, when one can be found. */
function restedCast(seed: string, recentPresets: string[], resting: string[]): IsekaiPacketCast {
  const rest = new Set(resting);
  let cast = isekaiCast(seed, recentPresets);
  for (let k = 1; k < LEAD_TRIES && rest.has(cast.lead.archetype); k++) cast = isekaiCast(`${seed}\0lead ${k}`, recentPresets);
  return cast;
}

const option = (
  { id, name, setting, archetypes, props, jokeHooks, notes, cast, memes, styleMix, diverseCast, leads, isekai, brainstorm }: Genre,
  seed = '',
  recentMemes: string[] = [],
  recentLeads: string[] = [],
  recentPresets: string[] = [],
  cooldown?: Cooldown,
  recentLayouts: string[][] = [],
): GenreOption => {
  const assignedLayout = layoutPick(`${seed}\0${id}`, recentLayouts);
  if (isekai) {
    const s = `${seed}\0${id}`;
    const crew = restedCast(s, recentPresets, [...(cooldown?.characters ?? []), ...(cooldown?.leads ?? [])]);
    const tropes = tropeOffer([crew.lead, ...crew.companions, ...crew.contacts].map((m) => m.title), s, cooldown);
    if (brainstorm === false) return { id, name, setting, archetypes, props, jokeHooks, ...(notes ? { notes } : {}), isekaiCast: crew, assignedLayout, tropeOffer: tropes };
    const pitches = drawPitches(crew, s, cooldown);
    return {
      id, name, setting, archetypes, props, jokeHooks,
      ...(notes ? { notes } : {}),
      isekaiCast: crew,
      pitches,
      memeList: memeChoices(pitches, s, cooldown),
      assignedLayout,
      tropeOffer: tropes,
    };
  }
  const plain = castOffer(cast, `${seed}\0${id}`);
  // A side-only comic's required archetype is a side character or a nemesis.
  const pool = plain?.kind === 'side-only' ? diverseCast?.filter((p) => p.role === 'side' || p.role === 'nemesis') : diverseCast;
  const hint = diverseHint(pool, `${seed}\0${id}`);
  const lead = leadPick(leads, `${seed}\0${id}`, recentLeads);
  const withHint = plain && hint ? withRequired(plain, hint) : plain;
  const offer = withHint && lead ? withLead(withHint, lead) : withHint;
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
    assignedLayout,
    ...(hint && !offer ? { requiredCast: hint } : {}),
    ...(lead && !offer ? { lead } : {}),
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
  opts: { seed?: string; pinned?: string; count?: number; catalog?: Genre[]; recentMemes?: string[]; recentLeads?: string[]; recentPresets?: string[]; history?: ComicSummary[]; cooldown?: Cooldown; recentLayouts?: string[][] } = {},
): GenreOption[] {
  if (opts.pinned) {
    const g = genreById(opts.pinned, opts.catalog);
    return [
      g
        ? option(g, opts.seed, opts.recentMemes, opts.recentLeads, opts.recentPresets, opts.cooldown ?? (opts.history ? cooldownFrom(opts.history) : undefined), opts.recentLayouts ?? (opts.history ?? []).map((c) => (c.layoutSignature ? [c.layoutSignature] : [])))
        : { id: opts.pinned, name: opts.pinned, setting: '', archetypes: [], props: [], jokeHooks: [] },
    ];
  }
  return freshGenres(recent, opts.seed, opts.catalog).slice(0, opts.count ?? 3).map((g) => option(g, opts.seed, opts.recentMemes, opts.recentLeads, opts.recentPresets, opts.cooldown ?? (opts.history ? cooldownFrom(opts.history) : undefined), opts.recentLayouts ?? (opts.history ?? []).map((c) => (c.layoutSignature ? [c.layoutSignature] : []))));
}

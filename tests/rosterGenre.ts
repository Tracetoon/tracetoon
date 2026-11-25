/**
 * A synthetic genre-file genre with a full persona roster, diverse archetypes,
 * leads, memes and a style mix, for testing the casting and offer mechanisms
 * without depending on any built-in genre's data.
 */
import { parseGenreFile } from '../src/comic/genreFile.ts';
import type { Genre } from '../src/comic/genres.ts';

export const ROSTER_GENRE_ID = 'roster-saga';

const roster: Record<string, string[]> = {
  hero: ['sunny swordsman', 'reluctant farmhand', 'bookish prince', 'stubborn shepherdess'],
  mage: ['ageless spellkeeper', 'nervous apprentice', 'fire-tempered sorceress', 'retired archmage', 'curious runecaster'],
  warrior: ['scarred shieldbearer', 'cheerful axewoman', 'silent spearman', 'boastful duelist', 'gentle giant knight'],
  healer: ['tired temple medic', 'herbalist grandmother', 'young cleric'],
  scout: ['quick-footed ranger', 'map-obsessed tracker', 'rooftop thief'],
  nemesis: ['brooding dark knight', 'smug rival mage', 'ancient dragon', 'hollow crown king', 'jealous former ally', 'clockwork tyrant', 'bored demon lord', 'rival guild leader'],
  side: ['tavern keeper', 'talking cat', 'guild receptionist', 'lost merchant', 'village elder', 'pet slime', 'traveling bard', 'blacksmith apprentice', 'grumpy innkeeper', 'messenger owl', 'fortune teller'],
};

const diverse: [string, string][] = [
  ['hero', 'a one-armed swordswoman — fights with her off hand'],
  ['mage', 'a deaf runecaster — signs her spells'],
  ['mage', 'two wedded hedge wizards — argue over every incantation'],
  ['warrior', 'a dark-skinned elf knight — polishes her armour daily'],
  ['warrior', 'an older veteran lancer — limps but never misses'],
  ['healer', 'a wheelchair-using alchemist — brews in a rolling lab'],
  ['scout', 'a nonbinary sky courier — rides a giant moth'],
  ['nemesis', 'a scheming dowager witch — plots over tea'],
  ['nemesis', 'a wounded former paladin — turned on the order'],
  ['side', 'a married pair of innkeepers — share every chore'],
  ['side', 'a blind librarian — knows every shelf by touch'],
  ['side', 'a towering half-orc baker — frosts tiny cakes'],
];

const leads: [string, string][] = [
  ['stereotype', 'a spiky-haired sword boy — dreams of being strongest'],
  ['stereotype', 'a summoned office worker — wakes in a meadow'],
  ['stereotype', 'a reincarnated slime hero — grows by absorbing'],
  ['stereotype', 'a cheerful noble daughter — dodges a bad ending'],
  ['stereotype', 'a lazy genius strategist — wins without moving'],
  ['stereotype', 'a weakest-rank adventurer — levels up alone'],
  ['stereotype', 'a gloomy demon heir — wants a quiet life'],
  ['stereotype', 'a lost academy freshman — fails every exam'],
  ['gender', 'a stern knight captain woman — leads the vanguard'],
  ['gender', 'a fierce girl blacksmith hero — forges her own blade'],
  ['gender', 'a boy who wanted to be a witch — joins the coven school'],
  ['gender', 'a middle-aged woman adventurer — returns to the guild'],
  ['orientation', 'a lovesick swordsman — courting the royal guard captain'],
  ['orientation', 'a sorceress and her rival — slowly falling for each other'],
  ['orientation', 'an aromantic paladin — loyal to friends above all'],
  ['orientation', 'a bisexual bard — writes songs about everyone'],
  ['race', 'a dark-skinned desert prince — rides a sand drake'],
  ['race', 'a horned demon-kin girl — proves herself to a human town'],
  ['race', 'a beastfolk ranger — reads the wind'],
  ['race', 'a dwarf scholar — lectures at the human academy'],
];

const memes = [
  '1 any: a level-one hero meets the final boss in the tutorial — the first PR touches the core module',
  '1 hero: a hero shouts the attack name before swinging — announcing a refactor in the commit title',
  '2 mage: a spell backfires into a rain of frogs — a config change with odd side effects',
  '2 nemesis: the villain explains the whole plan — a stack trace that tells you everything',
  '3 side: the guild receptionist stamps every quest form — the CI gate that checks paperwork',
  '3 any: an inn bed heals all wounds overnight — restarting the server fixes it',
];

const styleMix = ['anime-fantasy 7', 'chibi-anime 2', 'webtoon 1', 'shonen-action 2'];

const list = (key: string, items: string[]) => `${key}:\n${items.map((s) => `  - ${s}`).join('\n')}\n`;

export const ROSTER_GENRE_TEXT = `---
id: ${ROSTER_GENRE_ID}
name: Roster saga
setting: an invented sword-and-sorcery kingdom
archetypes:
  - adventurer
props:
  - quest board
  - guild card
jokeHooks:
  - the quest board posts an urgent bug bounty
styles:
  - anime-fantasy
${list('cast', Object.entries(roster).flatMap(([role, names]) => names.map((n) => `${role}: a ${n} — keeps to the ${role}'s part`)))}${list('diverseCast', diverse.map(([r, d]) => `${r}: ${d}`))}${list('leads', leads.map(([a, d]) => `${a}: ${d}`))}${list('memes', memes)}${list('styleMix', styleMix)}---
`;

/** The synthetic genre, parsed from its genre file; throws if the file has problems. */
export function rosterGenre(): Genre {
  const r = parseGenreFile(ROSTER_GENRE_TEXT);
  if (!r.genre) throw new Error(`roster genre: ${JSON.stringify(r.problems)}`);
  return r.genre;
}

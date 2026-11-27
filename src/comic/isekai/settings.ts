/**
 * Where an isekai comic happens, assigned by the host (round 19). Authors left
 * to choose put most comics at a guild counter, archive or dispatch desk, and
 * the joke drifted into office parody. Each comic now gets one adventure
 * setting, never one of the last SETTING_COOLDOWN comics' settings; `place`
 * must be a spot in it, and office-like places and bureaucracy jokes fail the
 * check.
 */
import { createHash } from 'node:crypto';

const unit = (seed: string) => createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;

export interface AdventureSetting {
  id: string;
  label: string;
  /** Example spots, for the author. */
  examples: string[];
  /** A `place` fits the setting when it names one of these. */
  words: RegExp;
}

export const SETTINGS: AdventureSetting[] = [
  { id: 'dungeon', label: 'a dungeon', examples: ['a trapped corridor', 'the boss door', 'a treasure room', 'a collapsing stair over a pit'], words: /\b(dungeon|labyrinth|crypt|catacomb|cave|cavern|boss (room|door|chamber)|treasure (room|vault)|pit)\b/i },
  { id: 'forest', label: 'a forest', examples: ['a mossy clearing', 'a giant tree root', 'a misty trail', 'a monster nest'], words: /\b(forest|woods?|grove|glade|clearing|thicket|jungle|trail)\b/i },
  { id: 'road', label: 'the open road', examples: ['a crossroads signpost', 'a caravan wagon', 'a rope bridge', 'a toll gate on a highway'], words: /\b(road|crossroads?|highway|caravan|wagon|carriage|bridge|path|signpost)\b/i },
  { id: 'camp', label: 'a campsite', examples: ['around the campfire', 'a tent at dusk', 'a night watch post', 'a camp cooking pot'], words: /\b(camp|campsite|campfire|tent|bonfire|bedrolls?)\b/i },
  { id: 'tavern', label: 'a tavern', examples: ['the crowded common room', 'the bar during a brawl', 'the inn stable', 'a table by the hearth'], words: /\b(tavern|inn|pub|common room|alehouse|bar)\b/i },
  { id: 'castle', label: 'a castle', examples: ['the throne room', 'a ballroom', 'the battlements', 'a castle courtyard'], words: /\b(castle|throne|palace|ballroom|battlements?|ramparts?|courtyard|keep|tower)\b/i },
  { id: 'market', label: 'a town market', examples: ['a market stall', 'the fountain square', 'a festival parade', 'a street food cart'], words: /\b(market|bazaar|stalls?|square|festival|fair|plaza|street|cart)\b/i },
  { id: 'ruins', label: 'ancient ruins', examples: ['a crumbling temple', 'a sealed altar', 'a moonlit shrine', 'a giant stone statue'], words: /\b(ruins?|ruined|temple|shrine|altar|sanctum|statue|monolith)\b/i },
  { id: 'water', label: 'the waterside', examples: ['a riverbank', 'a ship deck', 'a lakeside dock', 'a beach'], words: /\b(waterside|river(bank)?|lake(side)?|sea|ocean|beach|shore|harbou?r|docks?|ship|boat|waterfall|swamp)\b/i },
  { id: 'mountain', label: 'the mountains', examples: ['a cliff edge', 'a snowy pass', 'a dragon roost', 'a volcano rim'], words: /\b(mountains?|cliff|peak|summit|pass|ridge|glacier|volcano|crag|roost)\b/i },
  { id: 'village', label: 'a farming village', examples: ['a farm field', 'the village well', 'a cottage garden', 'a windmill'], words: /\b(village|farm|field|meadow|garden|cottage|windmill|orchard|well|barn|pasture)\b/i },
  { id: 'arena', label: 'an arena', examples: ['the arena floor', 'a tournament stand', 'a training yard', 'an exam field'], words: /\b(arena|colosseum|tournament|training (yard|ground|field)|duel(ling)? ground|stadium|exam field)\b/i },
];
export const SETTING_COOLDOWN = 3;

export function settingById(id: string): AdventureSetting | undefined {
  return SETTINGS.find((s) => s.id === id);
}

/** This comic's setting, by seed, never one of the last SETTING_COOLDOWN comics' (newest first). */
export function settingPick(seed: string, recent: (string | undefined)[] = []): AdventureSetting {
  const skip = new Set(recent.slice(0, SETTING_COOLDOWN).filter(Boolean));
  const pool = SETTINGS.filter((s) => !skip.has(s.id));
  const from = pool.length ? pool : SETTINGS;
  return from[Math.floor(unit(`isekai-setting\0${seed}`) * from.length)]!;
}

/** Office-like places: the desk, the counter, the paperwork room. */
export const OFFICE_PLACE = /\b(office|desk|counter|filing|paperwork|registry|registration|records?|permits?|intake|archives?|clerk'?s?|reception|bureau|cubicle|dispatch|front window|service window|teller|ledger room)\b/i;
/** Office-parody framing in the words on the page. */
export const OFFICE_JOKE = /\b(paperwork|bureaucra\w*|red tape|clerk|receptionist|inbox|filing cabinet|rubber stamp|in triplicate|fill (it |this |these )?out|forms? \d+-?\w*|desk job|office job|memo|overtime|timesheet|middle manager)\b/i;

/**
 * Built-in scenes: vivid, varied places a genre's comic can be staged in. Each
 * evokes the familiar tropes of the genre's famous works (a cantina of odd
 * aliens, an away team on a painted planet) without naming them or copying
 * their characters. Data lives in one JSON file per genre id.
 */
import type { GenreScene } from '../genres.ts';
import cyberpunk from './cyberpunk.json' with { type: 'json' };
import dungeonCrawl from './dungeon-crawl.json' with { type: 'json' };
import everyday from './everyday.json' with { type: 'json' };
import fantasyQuest from './fantasy-quest.json' with { type: 'json' };
import hauntedHouse from './haunted-house.json' with { type: 'json' };
import heist from './heist.json' with { type: 'json' };
import kaiju from './kaiju.json' with { type: 'json' };
import mecha from './mecha.json' with { type: 'json' };
import missionControl from './mission-control.json' with { type: 'json' };
import noirDetective from './noir-detective.json' with { type: 'json' };
import pirates from './pirates.json' with { type: 'json' };
import postApocalyptic from './post-apocalyptic.json' with { type: 'json' };
import retroRpg from './retro-rpg.json' with { type: 'json' };
import spaceOpera from './space-opera.json' with { type: 'json' };
import spyThriller from './spy-thriller.json' with { type: 'json' };
import superhero from './superhero.json' with { type: 'json' };
import timeTravel from './time-travel.json' with { type: 'json' };
import wildWest from './wild-west.json' with { type: 'json' };

export const BUILT_IN_SCENES: Record<string, GenreScene[]> = {
  'cyberpunk': cyberpunk as GenreScene[],
  'dungeon-crawl': dungeonCrawl as GenreScene[],
  'everyday': everyday as GenreScene[],
  'fantasy-quest': fantasyQuest as GenreScene[],
  'haunted-house': hauntedHouse as GenreScene[],
  'heist': heist as GenreScene[],
  'kaiju': kaiju as GenreScene[],
  'mecha': mecha as GenreScene[],
  'mission-control': missionControl as GenreScene[],
  'noir-detective': noirDetective as GenreScene[],
  'pirates': pirates as GenreScene[],
  'post-apocalyptic': postApocalyptic as GenreScene[],
  'retro-rpg': retroRpg as GenreScene[],
  'space-opera': spaceOpera as GenreScene[],
  'spy-thriller': spyThriller as GenreScene[],
  'superhero': superhero as GenreScene[],
  'time-travel': timeTravel as GenreScene[],
  'wild-west': wildWest as GenreScene[],
};

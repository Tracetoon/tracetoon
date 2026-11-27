/**
 * Genre files: the one way to add comic genres. A genre file is Markdown with
 * a small frontmatter block (scalars and `- item` lists) and an optional body
 * of extra direction for the comic author. Built-in genres ship in genres.ts;
 * the user's live in `<config dir>/genres/*.md` and a repo's in
 * `.github/tracetoon/genres/*.md`. A later scope replaces an earlier genre
 * with the same id: built-in, then user, then repo.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userConfigPath } from '../config.ts';
import { GENRES, MAX_GENRE_CHARS, type Genre } from './genres.ts';
import { CAST_ROLES, LEAD_AXES, MAX_CAST_ENTRY, parseCastEntry, type CastPersona } from './casting.ts';
import { MAX_MEME_ENTRY, parseMemeEntry, parseStyleMixEntry, withIds } from './memes.ts';
import { FRANCHISE_NAMES } from './script.ts';
import { styleById } from './styles.ts';

export interface GenreFileProblem {
  where: string;
  problem: string;
  severity?: 'warning';
}

export interface ParsedGenreFile {
  genre?: Genre;
  problems: GenreFileProblem[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const LIMITS = {
  name: MAX_GENRE_CHARS,
  setting: 240,
  item: 100,
  notes: 2000,
} as const;
const LISTS = {
  archetypes: { min: 1, max: 8 },
  props: { min: 1, max: 10 },
  jokeHooks: { min: 0, max: 8 },
  styles: { min: 0, max: 6 },
  cast: { min: 0, max: 48 },
  diverseCast: { min: 0, max: 120 },
  leads: { min: 0, max: 80 },
  memes: { min: 0, max: 400 },
  styleMix: { min: 0, max: 6 },
} as const;
type ListKey = keyof typeof LISTS;
const SCALARS = ['id', 'name', 'setting'] as const;
/**
 * Optional scalars: `casting: isekai` casts each comic from the isekai archetype
 * guide; `brainstorm: off` writes its comics directly instead of brainstorming ideas first.
 */
const OPTIONAL_SCALARS = ['casting', 'brainstorm'] as const;
const KNOWN = new Set<string>([...SCALARS, ...OPTIONAL_SCALARS, ...Object.keys(LISTS)]);

/** `user`: `<config dir>/genres`, beside the user's config.json. */
export function userGenresDir(): string {
  return join(dirname(userConfigPath()), 'genres');
}

/** `repo`: `.github/tracetoon/genres` in the repository. */
export function repoGenresDir(root: string): string {
  return join(root, '.github', 'tracetoon', 'genres');
}

const unquote = (v: string) => {
  const t = v.trim();
  return t.length >= 2 && /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/** Splits `---` frontmatter into scalars and lists; returns the body after it. */
function frontmatter(text: string): {
  fields: Map<string, string | string[]>;
  body: string;
  problems: GenreFileProblem[];
} {
  const problems: GenreFileProblem[] = [];
  const fields = new Map<string, string | string[]>();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    problems.push({ where: 'file', problem: 'must start with a `---` frontmatter block' });
    return { fields, body: '', problems };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) {
    problems.push({ where: 'file', problem: 'the frontmatter block has no closing `---`' });
    return { fields, body: '', problems };
  }
  let list: string | undefined;
  for (const [i, raw] of lines.slice(1, end).entries()) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item) {
      const cur = list ? fields.get(list) : undefined;
      if (!list || !Array.isArray(cur)) {
        problems.push({ where: `line ${i + 2}`, problem: 'a `- item` outside a list field' });
        continue;
      }
      cur.push(unquote(item[1]!));
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) {
      problems.push({ where: `line ${i + 2}`, problem: 'expected `key: value` or `- item`' });
      continue;
    }
    const [, key, value] = kv as unknown as [string, string, string];
    if (fields.has(key)) problems.push({ where: key, problem: 'appears twice' });
    if (value.trim()) {
      fields.set(key, unquote(value));
      list = undefined;
    } else {
      fields.set(key, []);
      list = key;
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n').trim(), problems };
}

/** Reads and validates one genre file's text. `path` is only recorded. */
export function parseGenreFile(
  text: string,
  opts: { path?: string; source?: Genre['source'] } = {},
): ParsedGenreFile {
  const { fields, body, problems } = frontmatter(text);
  if (problems.some((p) => p.where === 'file')) return { problems };
  const bad = (where: string, problem: string) => problems.push({ where, problem });

  for (const key of fields.keys())
    if (!KNOWN.has(key))
      bad(key, `unknown field; use ${[...KNOWN].join(', ')}`);

  const scalar = (key: (typeof SCALARS)[number]): string => {
    const v = fields.get(key);
    if (v === undefined || (typeof v === 'string' && !v.trim())) {
      bad(key, 'is required');
      return '';
    }
    if (Array.isArray(v)) {
      bad(key, 'must be one line of text, not a list');
      return '';
    }
    return v.trim();
  };
  const id = scalar('id').toLowerCase();
  const name = scalar('name');
  const setting = scalar('setting');
  if (id && (!ID.test(id) || id.length > MAX_GENRE_CHARS))
    bad('id', `use lowercase letters, digits and dashes, under ${MAX_GENRE_CHARS} characters`);
  if (name.length > LIMITS.name) bad('name', `keep it under ${LIMITS.name} characters`);
  if (setting.length > LIMITS.setting) bad('setting', `keep it under ${LIMITS.setting} characters`);

  const list = (key: ListKey): string[] => {
    const v = fields.get(key);
    if (v === undefined) {
      if (LISTS[key].min) bad(key, `is required: a list of ${LISTS[key].min}–${LISTS[key].max} items`);
      return [];
    }
    if (!Array.isArray(v)) {
      bad(key, 'must be a list (`- item` lines under it)');
      return [];
    }
    const items = v.map((s) => s.trim()).filter(Boolean);
    if (items.length < LISTS[key].min || items.length > LISTS[key].max)
      bad(key, `needs ${LISTS[key].min}–${LISTS[key].max} items (has ${items.length})`);
    const limit = key === 'cast' || key === 'diverseCast' || key === 'leads' ? MAX_CAST_ENTRY : key === 'memes' ? MAX_MEME_ENTRY : LIMITS.item;
    items.forEach((s, i) => {
      if (s.length > limit) bad(`${key}[${i}]`, `keep it under ${limit} characters`);
    });
    return items;
  };
  const casting = fields.get('casting');
  if (casting !== undefined && casting !== 'isekai') bad('casting', 'the only casting is "isekai" (the isekai archetype guide)');
  const brainstorm = fields.get('brainstorm');
  if (brainstorm !== undefined && brainstorm !== 'on' && brainstorm !== 'off') bad('brainstorm', 'must be on or off');
  const archetypes = list('archetypes');
  const props = list('props');
  const jokeHooks = list('jokeHooks');
  const styles = list('styles').map((s) => s.toLowerCase());
  // A persona roster: `role: name — details`. The author is offered five per comic.
  const castEntries = list('cast');
  const cast: CastPersona[] = [];
  castEntries.forEach((e, i) => {
    const persona = parseCastEntry(e);
    if (!persona) bad(`cast[${i}]`, `write it as "role: name — details", role one of ${CAST_ROLES.join(', ')}`);
    else if (cast.some((c) => c.id === persona.id)) bad(`cast[${i}]`, `"${persona.name}" repeats another persona's name`);
    else cast.push(persona);
  });
  // Diverse archetypes from the genre's source works: `role: name — details`, any role word.
  const diverseEntries = list('diverseCast');
  const diverseCast: CastPersona[] = [];
  diverseEntries.forEach((e, i) => {
    const persona = parseCastEntry(e, { anyRole: true });
    if (!persona) bad(`diverseCast[${i}]`, 'write it as "role: name — details"');
    else if (diverseCast.some((c) => c.id === persona.id) || cast.some((c) => c.id === persona.id)) bad(`diverseCast[${i}]`, `"${persona.name}" repeats another persona's name`);
    else diverseCast.push(persona);
  });
  // Leads: `axis: name — details`, axis one of stereotype, gender, orientation, race.
  const leadEntries = list('leads');
  const leads: CastPersona[] = [];
  leadEntries.forEach((e, i) => {
    const persona = parseCastEntry(e, { anyRole: true });
    if (!persona || !(LEAD_AXES as readonly string[]).includes(persona.role)) bad(`leads[${i}]`, `write it as "axis: name — details", axis one of ${LEAD_AXES.join(', ')}`);
    else if (leads.some((c) => c.id === persona.id)) bad(`leads[${i}]`, `"${persona.name}" repeats another lead's name`);
    else leads.push(persona);
  });
  // Genre memes: `tier roles: meme — use`. Each comic is offered three.
  const memeEntries = list('memes');
  const rawMemes = memeEntries.flatMap((e, i) => {
    const m = parseMemeEntry(e);
    if (!m) bad(`memes[${i}]`, 'write it as "tier roles: meme — use", tier 1 (iconic) to 3 (deep cut), roles comma-separated or any');
    return m ? [m] : [];
  });
  // Style mix: `style weight`; the host assigns each comic's style from it.
  const styleMix: Record<string, number> = {};
  list('styleMix').forEach((e, i) => {
    const pair = parseStyleMixEntry(e);
    if (!pair) bad(`styleMix[${i}]`, 'write it as "style-id weight", e.g. "anime-fantasy 7"');
    else if (!styleById(pair[0])) bad(`styleMix[${i}]`, `"${pair[0]}" is not a Tracetoon style id (see references/styles.md)`);
    else styleMix[pair[0]] = pair[1];
  });
  styles.forEach((s, i) => {
    if (!styleById(s)) bad(`styles[${i}]`, `"${s}" is not a Tracetoon style id (see references/styles.md)`);
  });
  if (body.length > LIMITS.notes) bad('body', `keep the notes under ${LIMITS.notes} characters`);

  const texts: [string, string][] = [
    ['name', name],
    ['setting', setting],
    ...archetypes.map((s, i): [string, string] => [`archetypes[${i}]`, s]),
    ...props.map((s, i): [string, string] => [`props[${i}]`, s]),
    ...jokeHooks.map((s, i): [string, string] => [`jokeHooks[${i}]`, s]),
    ...castEntries.map((s, i): [string, string] => [`cast[${i}]`, s]),
    ...memeEntries.map((s, i): [string, string] => [`memes[${i}]`, s]),
    ...diverseEntries.map((s, i): [string, string] => [`diverseCast[${i}]`, s]),
    ...leadEntries.map((s, i): [string, string] => [`leads[${i}]`, s]),
    ['body', body],
  ];
  for (const [where, s] of texts) {
    const hit = FRANCHISE_NAMES.exec(s);
    if (hit)
      problems.push({
        where,
        problem: `"${hit[0]}" names a specific work's character, ship or trademark; generalize to the archetype`,
        severity: 'warning',
      });
  }

  if (problems.some((p) => p.severity !== 'warning')) return { problems };
  return {
    genre: {
      id,
      name,
      setting,
      archetypes,
      props,
      jokeHooks,
      styles,
      ...(body ? { notes: body } : {}),
      ...(cast.length ? { cast } : {}),
      ...(diverseCast.length ? { diverseCast } : {}),
      ...(leads.length ? { leads } : {}),
      ...(casting === 'isekai' ? { isekai: true } : {}),
      ...(brainstorm === 'off' ? { brainstorm: false } : brainstorm === 'on' ? { brainstorm: true } : {}),
      ...(rawMemes.length ? { memes: withIds(rawMemes) } : {}),
      ...(Object.keys(styleMix).length ? { styleMix } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.path ? { path: opts.path } : {}),
    },
    problems,
  };
}

export interface GenreFileResult extends ParsedGenreFile {
  path: string;
  source: 'user' | 'repo';
}

/** Every `*.md` genre file in one folder, parsed, in name order. */
function readFolder(dir: string, source: 'user' | 'repo'): GenreFileResult[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  } catch {
    return [];
  }
  return names.map((n) => {
    const path = join(dir, n);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (e) {
      return { path, source, problems: [{ where: 'file', problem: `can't be read: ${(e as Error).message}` }] };
    }
    return { path, source, ...parseGenreFile(text, { path, source }) };
  });
}

export interface GenreCatalog {
  /** Built-in genres, then user and repo genres (a later scope replaces the same id). */
  genres: Genre[];
  /** Every user and repo genre file read, with its problems. */
  files: GenreFileResult[];
}

/** The genres available here: built-in, the user's, and the repo's (when `root` is given). */
export function loadGenreCatalog(root?: string): GenreCatalog {
  const files = [
    ...readFolder(userGenresDir(), 'user'),
    ...(root ? readFolder(repoGenresDir(root), 'repo') : []),
  ];
  const byId = new Map<string, Genre>(
    GENRES.map((g) => [g.id, { ...g, source: 'built-in' as const }]),
  );
  for (const f of files) if (f.genre) byId.set(f.genre.id, f.genre);
  return { genres: [...byId.values()], files };
}

/** Just the genres, for callers that don't report file problems. */
export const genreCatalog = (root?: string): Genre[] => loadGenreCatalog(root).genres;

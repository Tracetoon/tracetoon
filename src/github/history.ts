/**
 * Fetch prior PR bodies to decode metadata, then pass only compact creative
 * choices forward. Old transcripts and character descriptions are not context.
 */
import type { PrTruth } from '../git/pr.ts';
import { gh } from '../util/exec.ts';
import { repoArgs } from './target.ts';
import { decodeMeta } from './body.ts';
import { genreKey, MAX_GENRE_CHARS } from '../comic/genres.ts';
import { ARCHETYPE_ID, castNames, PITCH_ID } from '../comic/composition.ts';
import {
  CAST_KINDS,
  LAYOUT_FAMILIES,
  KNOWN_STYLE_FAMILIES,
  type ComicSummary,
} from '../comic/types.ts';

/** How many recent PRs to look at: enough for the 100-comic meme cooldown (isekai/pitches.ts). */
const LOOK_BACK = 100;
/** How many recent comics are passed forward as creative context. */
const RECENT = 5;

export function repoWeb(truth: PrTruth): string | undefined {
  if (process.env.TRACETOON_REPO_WEB) return process.env.TRACETOON_REPO_WEB;
  return truth.remote
    ? `https://github.com/${truth.remote.owner}/${truth.remote.name}`
    : undefined;
}

/** Styles of this repo's latest comics, newest first (empty offline or without gh). */
export function recentStyles(truth: PrTruth, opts: { offline?: boolean } = {}): string[] {
  return recentComics(truth, opts).flatMap((c) => (c.style ? [c.style] : []));
}

/** This repo's latest comics, newest first: the creative context (empty offline or without gh). */
export function recentComics(
  truth: PrTruth,
  opts: { offline?: boolean } = {},
): ComicSummary[] {
  return comicHistory(truth, opts).slice(0, RECENT);
}

/** Every comic in this repo's last LOOK_BACK PRs, newest first: the per-repo cooldowns. */
export function comicHistory(
  truth: PrTruth,
  opts: { offline?: boolean } = {},
): ComicSummary[] {
  if (opts.offline) return [];
  const r = gh(truth.toplevel, [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    String(LOOK_BACK),
    '--search',
    '"tracetoon:meta" in:body',
    ...repoArgs(truth.target?.repo),
    '--json',
    'number,body',
  ]);
  if (!r.ok) return [];
  try {
    const rows = JSON.parse(r.stdout) as { number: number; body: string }[];
    return rows
      .sort((a, b) => b.number - a.number)
      .flatMap((p): ComicSummary[] => {
        const meta = decodeMeta(p.body);
        if (!meta) return [];
        const raw = meta.comic;
        const summary: ComicSummary = {};
        if (typeof meta.style === 'string' && meta.style.length <= 120)
          summary.style = meta.style;
        if (raw && typeof raw === 'object') {
          if (
            typeof raw.genre === 'string' &&
            raw.genre.trim() &&
            raw.genre.length <= MAX_GENRE_CHARS
          )
            summary.genre = genreKey(raw.genre);
          if (raw.styleFamily && KNOWN_STYLE_FAMILIES.includes(raw.styleFamily))
            summary.styleFamily = raw.styleFamily;
          if (raw.layoutFamily && LAYOUT_FAMILIES.includes(raw.layoutFamily))
            summary.layoutFamily = raw.layoutFamily;
          if (typeof raw.layoutSignature === 'string' && /^(rows|cols):[1-3](-[1-3]){0,2}$/.test(raw.layoutSignature))
            summary.layoutSignature = raw.layoutSignature;
          if (typeof raw.setting === 'string' && /^[a-z]{2,20}$/.test(raw.setting))
            summary.setting = raw.setting;
          if (
            Number.isInteger(raw.panelCount) &&
            raw.panelCount! >= 1 &&
            raw.panelCount! <= 6
          )
            summary.panelCount = raw.panelCount;
          if (
            raw.titleTreatment &&
            ['none', 'integrated', 'heading'].includes(raw.titleTreatment)
          )
            summary.titleTreatment = raw.titleTreatment;
          if (
            Array.isArray(raw.castKinds) &&
            raw.castKinds.every((kind) => CAST_KINDS.includes(kind))
          )
            summary.castKinds = [...new Set(raw.castKinds)];
          if (
            Array.isArray(raw.castNames) &&
            raw.castNames.every((n: unknown) => typeof n === 'string' && n.length <= 40)
          )
            summary.castNames = castNames(raw.castNames);
          if (typeof raw.leadLook === 'string' && raw.leadLook.trim() && raw.leadLook.length <= 80)
            summary.leadLook = raw.leadLook.trim().toLowerCase();
          if (typeof raw.meme === 'string' && /^[a-z0-9-]{1,80}$/.test(raw.meme)) summary.meme = raw.meme;
          if (typeof raw.lead === 'string' && /^[a-z0-9-]{1,80}$/i.test(raw.lead)) summary.lead = raw.lead;
          if (typeof raw.castPreset === 'string' && /^[a-z_]{1,40}$/.test(raw.castPreset)) summary.castPreset = raw.castPreset;
          if (typeof raw.pitch === 'string' && PITCH_ID.test(raw.pitch)) summary.pitch = raw.pitch;
          if (Array.isArray(raw.archetypes) && raw.archetypes.length <= 12 && raw.archetypes.every((a: unknown) => typeof a === 'string' && ARCHETYPE_ID.test(a)))
            summary.archetypes = [...new Set(raw.archetypes as string[])];
        }
        return Object.keys(summary).length ? [summary] : [];
      });
  } catch {
    return [];
  }
}

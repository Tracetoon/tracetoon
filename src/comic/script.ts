/** Checks a comic script before any art is made. */
import { OFFICE_JOKE, OFFICE_PLACE, settingById } from './isekai/settings.ts';
import { presentationOf, SPECIES_WORDS } from './isekai/presentation.ts';
import { formatById, FORMATS } from './formats.ts';
import { styleById } from './styles.ts';
import { EVERYDAY, GENRES, genreKey, MAX_GENRE_CHARS, type Genre, type GenreOption } from './genres.ts';
import { PANEL_BACKGROUNDS } from './types.ts';
import {
  ASPECTS,
  BEATS,
  EXPRESSIONS,
  PALETTES,
  CAST_KINDS,
  DIALOGUE_KINDS,
  BALLOONS,
  CAMERAS,
  PANEL_EFFECTS,
  SFX_SIZES,
  KNOWN_STYLE_FAMILIES,
  STYLE_FAMILIES,
  type ComicScript,
  type ComicSummary,
} from './types.ts';
import { lookSimilarity, SAME_LOOK } from './casting.ts';
import {
  comicSummary,
  MAX_LEAD_LOOK,
  compositionProblems,
  visibleHeadline,
} from './composition.ts';

/** Words per text item on a page: one balloon, one breath. */
export const MAX_ITEM_WORDS = 30;
/**
 * All the words on a page, headline included. Comics are read on a desktop PR
 * page, so a longer joke has room; most good comics still use 30–90.
 */
export const MAX_PAGE_WORDS = 150;
/** Panels on one page: a big story moment can take a dense page. */
export const MAX_PANELS = 9;
export const MAX_HEADLINE_WORDS = 6;
export const MAX_CHARACTERS = 6;
export const MAX_STYLE_CHARS = 120;
/** A label names one thing; anything longer is a caption. */
export const MAX_LABEL_WORDS = 4;
export const MAX_ANCHOR_TERMS = 4;

export interface ScriptProblem {
  where: string;
  problem: string;
  /** Warnings don't block; errors do. */
  severity?: 'error' | 'warning';
}

export interface CheckOpts {
  /** Styles of the repo's latest comics, newest first. */
  recentStyles?: string[];
  /** A style the user pinned in config (always allowed, never a repeat). */
  pinnedStyle?: string;
  /** A genre the repo pinned in config (always allowed, never a repeat). */
  pinnedGenre?: string;
  recentComics?: ComicSummary[];
  /** The run's digest and diff, to notice anchor terms the PR never mentions. */
  evidenceText?: string;
  /** Genres available here (built-in plus user and repo genre files). */
  genres?: Genre[];
  /** The genres offered for this comic (context genreOptions), with any cast offers. */
  genreOptions?: GenreOption[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Case, spacing and quote marks don't matter when matching a term to lettering. */
const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Every piece of text the model is asked to letter, in reading order. */
export function pageText(s: ComicScript): string[] {
  return [
    visibleHeadline(s),
    ...s.panels.flatMap((p) => (p.dialogue ?? []).map((d) => d.text)),
  ].filter((t) => t?.trim());
}

export const errors = (ps: ScriptProblem[]) => ps.filter((p) => p.severity !== 'warning');

export function checkScript(script: unknown, opts: CheckOpts = {}): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  const bad = (where: string, problem: string) => out.push({ where, problem });
  const warn = (where: string, problem: string) =>
    out.push({ where, problem, severity: 'warning' });
  if (typeof script !== 'object' || script === null)
    return [{ where: 'comic.json', problem: 'is not a JSON object' }];
  const s = script as Partial<ComicScript> & { v?: unknown };
  if (s.v !== 2)
    bad(
      'v',
      s.v === 1
        ? 'the fixed 4-panel format (v1) was removed; write a page ("v": 2) with its own characters'
        : 'must be 2',
    );
  for (const key of ['title', 'synopsis', 'altText'] as const) {
    if (typeof s[key] !== 'string' || !s[key]!.trim()) bad(key, 'is required');
  }

  const format = formatById(s.format);
  if (!format) bad('format', `must be one of ${FORMATS.map((f) => f.id).join(', ')}`);
  if (s.format === 'custom' && !s.layout?.trim() && !s.composition)
    bad('layout', 'is required for a custom format: describe the page');
  if (!Array.isArray(s.panels) || s.panels.length < 1 || s.panels.length > MAX_PANELS) {
    bad('panels', `must have 1 to ${MAX_PANELS} panels`);
    return out;
  }
  if (
    format &&
    (s.panels.length < format.panels[0] || s.panels.length > format.panels[1])
  )
    warn(
      'panels',
      `${format.name} usually has ${format.panels[0]}–${format.panels[1]} panels; you have ${s.panels.length}`,
    );
  if (s.aspect && !ASPECTS.includes(s.aspect))
    bad('aspect', `must be one of ${ASPECTS.join(', ')}`);
  out.push(...compositionProblems(s as ComicScript));
  if (s.avoid !== undefined && (!Array.isArray(s.avoid) || s.avoid.length > 8 || s.avoid.some((a) => typeof a !== 'string' || a.length > 240)))
    bad('avoid', 'must be a list of at most 8 short strings (things the image must not show)');
  if (s.leadLook !== undefined && (typeof s.leadLook !== 'string' || s.leadLook.length > MAX_LEAD_LOOK))
    bad('leadLook', `must be a few words, at most ${MAX_LEAD_LOOK} characters`);
  if (s.styleFamily && !KNOWN_STYLE_FAMILIES.includes(s.styleFamily))
    bad('styleFamily', `must be ${STYLE_FAMILIES.join(', ')}`);
  if (s.headline !== undefined && typeof s.headline !== 'string')
    bad('headline', 'must be text');

  // Any art style: an idea by id, or the agent's own words.
  if (typeof s.style !== 'string' || !s.style.trim())
    bad('style', 'is required: a style idea id (see styles.md) or your own description');
  else if (s.style.length > MAX_STYLE_CHARS)
    bad('style', `keep it under ${MAX_STYLE_CHARS} characters`);
  else {
    if (opts.pinnedStyle && !same(s.style, opts.pinnedStyle))
      bad('style', `this repo pins the style "${opts.pinnedStyle}" (config style)`);
  }
  if (s.request !== undefined && (typeof s.request !== 'string' || !s.request.trim()))
    bad('request', "must be the user's request in words (or left out)");
  out.push(...genreProblems(s as ComicScript, opts));
  out.push(...personaProblems(s as ComicScript, opts));
  out.push(...offerProblems(s as ComicScript, opts));
  out.push(...balloonOrderProblems(s as ComicScript));
  out.push(...isekaiProblems(s as ComicScript, opts));
  out.push(...decisionProblems(s as ComicScript));
  out.push(...franchiseProblems(s as ComicScript));
  if (s.palette && !PALETTES.includes(s.palette))
    bad('palette', `must be one of ${PALETTES.join(', ')}`);
  const idea = styleById(s.style);
  if (idea && s.palette && !idea.palettes.includes(s.palette))
    warn('palette', `${idea.name} is usually ${idea.palettes.join(' or ')}`);
  const headline = visibleHeadline(s as ComicScript);
  if (words(headline) > MAX_HEADLINE_WORDS)
    bad('headline', `has ${words(headline)} words; keep it to ${MAX_HEADLINE_WORDS}`);

  // Characters are invented for this comic and described once.
  const names = new Set<string>();
  if (s.characters !== undefined && !Array.isArray(s.characters))
    bad('characters', 'must be a list of { name, description }');
  for (const [i, c] of (Array.isArray(s.characters) ? s.characters : []).entries()) {
    if (!c?.name?.trim()) bad(`characters[${i}].name`, 'is required');
    else if (names.has(c.name.toLowerCase()))
      bad(`characters[${i}].name`, `"${c.name}" is listed twice`);
    else names.add(c.name.toLowerCase());
    if (!c?.description?.trim())
      bad(`characters[${i}].description`, 'describe what this character looks like');
    if (c?.kind !== undefined && !CAST_KINDS.includes(c.kind))
      bad(`characters[${i}].kind`, `must be ${CAST_KINDS.join(', ')}`);
  }
  if (names.size > MAX_CHARACTERS)
    bad('characters', `at most ${MAX_CHARACTERS} characters per comic`);
  const listed = [...names].join(', ') || 'none listed';

  const total = pageText(s as ComicScript).reduce((n, t) => n + words(t), 0);
  if (total > MAX_PAGE_WORDS)
    bad(
      'panels',
      `the page has ${total} words; keep it to ${MAX_PAGE_WORDS} so the joke stays quick to read`,
    );

  s.panels.forEach((p, i) => {
    const at = `panels[${i}]`;
    if (p.beat && !BEATS.includes(p.beat))
      bad(`${at}.beat`, `must be one of ${BEATS.join(', ')} (or left out)`);
    if (!p.scene?.trim()) bad(`${at}.scene`, 'is required');
    if (p.drawn !== undefined && (typeof p.drawn !== 'string' || !p.drawn.trim()))
      bad(`${at}.drawn`, 'must be a sentence describing the finished art (or left out)');
    if (!Array.isArray(p.characters)) bad(`${at}.characters`, 'must be a list');
    for (const [j, c] of (p.characters ?? []).entries()) {
      if (!c?.name || !names.has(c.name.toLowerCase()))
        bad(
          `${at}.characters[${j}].name`,
          `"${c?.name ?? ''}" isn't in this comic's characters (${listed})`,
        );
      if (!['left', 'center', 'right'].includes(c?.position))
        bad(`${at}.characters[${j}].position`, 'must be left, center or right');
      if (c?.expression && !EXPRESSIONS.includes(c.expression))
        bad(
          `${at}.characters[${j}].expression`,
          `must be one of ${EXPRESSIONS.join(', ')}`,
        );
    }
    if ((p.characters ?? []).length > 4)
      bad(`${at}.characters`, 'at most 4 characters per panel');
    if (p.camera !== undefined && !CAMERAS.includes(p.camera))
      bad(`${at}.camera`, `must be one of ${CAMERAS.join(', ')}`);
    if (p.effects !== undefined) {
      if (!Array.isArray(p.effects) || p.effects.some((e) => !PANEL_EFFECTS.includes(e)))
        bad(`${at}.effects`, `must be a list of ${PANEL_EFFECTS.join(', ')}`);
    }
    if (!Array.isArray(p.dialogue)) bad(`${at}.dialogue`, 'must be a list');
    if ((p.dialogue ?? []).length > 4) bad(`${at}.dialogue`, 'at most 4 lines per panel');
    for (const [j, d] of (p.dialogue ?? []).entries()) {
      const w = `${at}.dialogue[${j}]`;
      const narration =
        d.speaker === 'caption' ||
        d.kind === 'sfx' ||
        d.kind === 'sign' ||
        d.kind === 'label';
      if (!narration && !names.has(String(d.speaker).toLowerCase()))
        bad(
          `${w}.speaker`,
          `"${d.speaker}" isn't in this comic's characters (${listed})`,
        );
      if (d.kind && !DIALOGUE_KINDS.includes(d.kind))
        bad(`${w}.kind`, `must be ${DIALOGUE_KINDS.join(', ')}`);
      if (d.points !== undefined && typeof d.points !== 'string')
        bad(`${w}.points`, 'must name the surface or element the words are on');
      if (d.balloon !== undefined && !BALLOONS.includes(d.balloon))
        bad(`${w}.balloon`, `must be one of ${BALLOONS.join(', ')}`);
      if (d.balloon !== undefined && (narration || d.kind === 'caption'))
        warn(`${w}.balloon`, 'only spoken lines have balloons; captions, signs and sound effects ignore it');
      if (d.size !== undefined && (d.kind !== 'sfx' || !SFX_SIZES.includes(d.size)))
        bad(`${w}.size`, `is for sound effects ("kind": "sfx") and must be ${SFX_SIZES.join(', ')}`);
      if (
        d.emphasis !== undefined &&
        (!Array.isArray(d.emphasis) ||
          d.emphasis.some((e) => typeof e !== 'string' || !(d.text ?? '').toLowerCase().includes(e.toLowerCase())))
      )
        bad(`${w}.emphasis`, 'must list words that appear in the text');
      if (d.kind === 'label')
        warn(
          `${w}.kind`,
          'labels look like pointer tags; letter the words on something in the scene ("kind": "sign", with `points` naming the surface) or say them in dialogue',
        );
      if (!d.text?.trim()) bad(`${w}.text`, 'is empty');
      else if (d.kind === 'label' && words(d.text) > MAX_LABEL_WORDS)
        bad(
          `${w}.text`,
          `a label has ${words(d.text)} words; keep it to ${MAX_LABEL_WORDS} (use a caption for more)`,
        );
      else if (words(d.text) > MAX_ITEM_WORDS)
        bad(`${w}.text`, `has ${words(d.text)} words; keep it to ${MAX_ITEM_WORDS}`);
      if (/https?:\/\/|@\w/.test(d.text ?? ''))
        bad(`${w}.text`, 'must not contain links or @mentions');
    }
  });
  out.push(...anchorProblems(s as ComicScript, opts.evidenceText));
  if (!out.some((p) => p.severity !== 'warning')) {
    const current = comicSummary(s as ComicScript);
    const recent = (opts.recentComics ?? []).slice(0, 5);
    if (
      current.layoutFamily &&
      recent
        .slice(0, 3)
        .filter(
          (r) =>
            r.layoutFamily === current.layoutFamily &&
            r.panelCount === current.panelCount &&
            r.titleTreatment === current.titleTreatment,
        ).length >= 2
    )
      warn(
        'composition',
        'This layout, panel count and title treatment repeat recent comics. Consider a different concept; keep it if the story earns it.',
      );
    const lookAlike = current.leadLook
      ? recent.find((r) => r.leadLook && lookSimilarity(r.leadLook, current.leadLook!) >= SAME_LOOK)
      : undefined;
    if (lookAlike)
      warn(
        'leadLook',
        `the lead looks like a recent comic's lead ("${lookAlike.leadLook}"); cast a different kind of character (age, build, role or costume) in the genre's own look`,
      );
    const reused = (current.castNames ?? []).filter((n) =>
      recent.some((r) => r.castNames?.includes(n)),
    );
    if (reused.length)
      warn(
        'characters',
        `${reused.map((n) => `"${n}"`).join(', ')} already appeared in a recent comic. Invent this comic's own names, from what the characters do in this story.`,
      );
    if (
      current.panelCount === 2 &&
      current.layoutFamily === 'comparison' &&
      recent
        .slice(0, 2)
        .some((r) => r.panelCount === 2 && r.layoutFamily === 'comparison')
    )
      warn(
        'composition',
        'Another two-panel before/after. Most jokes want a setup, a build and a punchline; use two panels only when the contrast itself is the punchline.',
      );
    if (
      current.castKinds?.includes('creature') &&
      !current.castKinds.includes('human') &&
      recent.slice(0, 2).length === 2 &&
      recent
        .slice(0, 2)
        .every((r) => r.castKinds?.includes('creature') && !r.castKinds.includes('human'))
    )
      warn(
        'characters',
        'Recent comics already used creature-led casts. Consider people, objects or a characterless metaphor; keep creatures when they strengthen this gag.',
      );
  }
  return out;
}

/**
 * The anchor ties the comic to the PR: a reviewer who reads only the comic
 * should be able to name the change. Required for composed (current) scripts;
 * legacy scripts without `composition` keep working.
 */
export function anchorProblems(s: ComicScript, evidenceText?: string): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  const bad = (where: string, problem: string) => out.push({ where, problem });
  const warn = (where: string, problem: string) =>
    out.push({ where, problem, severity: 'warning' });
  const a = s.anchor as Partial<ComicScript['anchor'] & object> | undefined;
  if (a === undefined) {
    if (s.composition)
      bad(
        'anchor',
        'is required: the change in one sentence, 1–4 real terms from the PR, and what each drawn element stands for',
      );
    return out;
  }
  if (typeof a !== 'object' || a === null)
    return [{ where: 'anchor', problem: 'must be an object' }];
  if (typeof a.change !== 'string' || !a.change.trim())
    bad('anchor.change', 'state the concrete change in one sentence');
  const terms = Array.isArray(a.terms)
    ? a.terms.filter((t): t is string => typeof t === 'string' && !!t.trim())
    : [];
  if (!Array.isArray(a.terms) || terms.length !== a.terms.length || terms.length < 1)
    bad(
      'anchor.terms',
      'list 1–4 real names from the PR (command, flag, file, error, concept)',
    );
  else if (terms.length > MAX_ANCHOR_TERMS)
    bad(
      'anchor.terms',
      `at most ${MAX_ANCHOR_TERMS} terms; keep the ones the comic shows`,
    );
  const mapping = Array.isArray(a.mapping) ? a.mapping : undefined;
  if (!mapping || mapping.length < 1)
    bad('anchor.mapping', 'say which drawn element stands for which technical thing');
  else
    mapping.forEach((m, i) => {
      if (!m || typeof m.visual !== 'string' || !m.visual.trim())
        bad(`anchor.mapping[${i}].visual`, 'name the drawn element');
      if (!m || typeof m.technical !== 'string' || !m.technical.trim())
        bad(`anchor.mapping[${i}].technical`, 'name what it stands for in the PR');
    });
  if (!terms.length || !Array.isArray(s.panels)) return out;

  const visible = pageText(s).map(loose);
  if (!terms.some((t) => visible.some((v) => v.includes(loose(t)))))
    bad(
      'anchor.terms',
      `none of ${terms.map((t) => `"${t}"`).join(', ')} is lettered in the comic; put one in the scene (a screen, a sign, a box stamp) or in someone's line so a reviewer can tie the picture to the PR`,
    );
  const labels = s.panels.flatMap((p) => p.dialogue ?? []);
  (mapping ?? []).forEach((m, i) => {
    if (!m?.visual || !m.technical) return;
    const v = loose(m.visual);
    const t = loose(m.technical);
    const labelled = labels.some(
      (d) =>
        (d.points && (loose(d.points).includes(v) || v.includes(loose(d.points)))) ||
        loose(d.text).includes(t) ||
        t.includes(loose(d.text)),
    );
    if (!labelled)
      warn(
        `anchor.mapping[${i}]`,
        `"${m.visual}" stands for "${m.technical}" but no words in the scene or dialogue say so; readers may miss the connection`,
      );
  });
  if (evidenceText) {
    const evidence = loose(evidenceText);
    for (const t of terms)
      if (!evidence.includes(loose(t)))
        warn(
          'anchor.terms',
          `"${t}" doesn't appear in this PR's digest or diff; use the names the change actually uses`,
        );
  }
  return out;
}

/** A plain-text transcript of the comic for the PR body (accessibility). */
export function transcript(script: ComicScript): string {
  const shown = script.composition ? visibleHeadline(script) : script.headline;
  const head = shown ? `**${shown}**\n\n` : '';
  return (
    head +
    script.panels
      .map((p, i) => {
        const lines = p.dialogue.map((d) =>
          d.kind === 'label' || d.kind === 'sign'
            ? `[${d.points ? `on ${d.points}: ` : ''}${d.text}]`
            : d.speaker === 'caption' || d.kind === 'caption'
              ? `*${d.text}*`
              : d.kind === 'sfx'
                ? `**${d.text}**`
                : `**${d.speaker}:** ${d.text}`,
        );
        return `${i + 1}. ${p.drawn ?? p.scene}${lines.length ? '\n   ' + lines.join('\n   ') : ''}`;
      })
      .join('\n')
  );
}

/**
 * The genre is chosen first and rotates: a composed script names one, and it
 * can't repeat either of the repo's last two comics. The user's explicit
 * request or the repo's pinned genre is always allowed.
 */
export function genreProblems(s: ComicScript, opts: CheckOpts = {}): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  const bad = (problem: string) => out.push({ where: 'genre', problem });
  const warn = (problem: string) => out.push({ where: 'genre', problem, severity: 'warning' });
  const ids = (opts.genres ?? GENRES).map((g) => g.id).join(', ');
  if (s.genre === undefined) {
    if (s.composition)
      bad(
        `is required: pick it first from context.comic.genreOptions (or one of ${ids}, or a short phrase of your own)`,
      );
    return out;
  }
  if (typeof s.genre !== 'string' || !s.genre.trim()) {
    bad('must be a genre id or a short phrase');
    return out;
  }
  const key = genreKey(s.genre);
  // The repo's pin decides first, whatever its length: a long pinned phrase
  // must not make every comic fail.
  if (opts.pinnedGenre) {
    if (key !== genreKey(opts.pinnedGenre))
      bad(`this repo pins the genre "${opts.pinnedGenre}" (config genre)`);
    return out;
  }
  if (s.genre.length > MAX_GENRE_CHARS) {
    bad(`keep it under ${MAX_GENRE_CHARS} characters`);
    return out;
  }
  if (s.request?.trim()) return out;
  const recent = (opts.recentComics ?? []).map((r) => r.genre);
  if (recent.slice(0, 2).includes(key))
    bad(
      `"${s.genre}" repeats one of the last two comics; pick another genre from context.comic.genreOptions`,
    );
  else if (key === EVERYDAY && recent.slice(0, 4).filter((g) => g === EVERYDAY).length >= 2)
    warn(
      'Recent comics were already set in everyday life. A genre world (space opera, fantasy quest, heist, ...) usually lands harder; keep everyday only if nothing else fits.',
    );
  return out;
}

/** Words that leave a choice open: a design or place must be decided, not a menu. */
export const OPEN_CHOICE = /\b(or|either|choose|such as|e\.g\.|for example|optionally|alternatively)\b/i;

/**
 * Decisions the image model must receive already made: one place, and a
 * background for every panel when the script uses them.
 */
export function decisionProblems(s: ComicScript): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  if (s.place !== undefined) {
    if (typeof s.place !== 'string' || !s.place.trim() || s.place.length > 140) out.push({ where: 'place', problem: 'must be one concrete place in a short phrase' });
    else if (OPEN_CHOICE.test(s.place) || /[;/]|,.*,/.test(s.place)) out.push({ where: 'place', problem: `"${s.place}" lists options; decide the one place the comic happens` });
  }
  for (const [i, p] of (Array.isArray(s.panels) ? s.panels : []).entries())
    if (p.background !== undefined && !(PANEL_BACKGROUNDS as readonly string[]).includes(p.background))
      out.push({ where: `panels[${i}].background`, problem: `must be one of ${PANEL_BACKGROUNDS.join(', ')}` });
  return out;
}

/**
 * The isekai cast (archetype guide): the page shows the generated lead plus at
 * most two companions and one contact, each with one final design, in one place.
 */
export function isekaiProblems(s: ComicScript, opts: CheckOpts = {}): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  if (typeof s.genre !== 'string') return out;
  const option = opts.genreOptions?.find((g) => genreKey(g.id) === genreKey(s.genre!));
  const cast = option?.isekaiCast;
  if (!cast) return out;
  const bad = (where: string, problem: string) => out.push({ where, problem });
  const roleOf = new Map<string, 'lead' | 'companion' | 'contact'>([
    [cast.lead.archetype, 'lead'],
    ...cast.companions.map((m) => [m.archetype, 'companion'] as [string, 'companion']),
    ...cast.contacts.map((m) => [m.archetype, 'contact'] as [string, 'contact']),
  ]);
  const ids = [...roleOf.keys()].join(', ');
  if (s.castPreset !== cast.preset.id) bad('castPreset', `must be "${cast.preset.id}" (this comic's cast preset)`);
  const chars = Array.isArray(s.characters) ? s.characters : [];
  const roles = { lead: 0, companion: 0, contact: 0 };
  for (const [i, c] of chars.entries()) {
    const role = c.archetype ? roleOf.get(c.archetype) : undefined;
    if (!role) bad(`characters[${i}].archetype`, `must be one of this comic's cast: ${ids}`);
    else roles[role]++;
    if (typeof c.description === 'string' && OPEN_CHOICE.test(c.description))
      bad(`characters[${i}].description`, 'still leaves a choice open ("or", "such as", "choose"…); decide one final design');
    const shown = presentationOf(c.archetype);
    const word = typeof c.description === 'string' && shown && shown.base !== 'creature' ? SPECIES_WORDS.exec(c.description)?.[0] : undefined;
    if (word)
      bad(`characters[${i}].description`, `says "${word}", which an image model draws as an animal-headed creature; describe the base body and traits from \`presentation\` instead (${shown!.presentation})`);
  }
  if (!roles.lead) bad('characters', `must include the lead, "${cast.lead.title}" (${cast.lead.archetype})`);
  if (roles.companion > cast.onPage.companions) bad('characters', `at most ${cast.onPage.companions} companions on the page (has ${roles.companion})`);
  if (roles.contact > cast.onPage.contacts) bad('characters', `at most ${cast.onPage.contacts} local contact on the page (has ${roles.contact})`);
  const leadChar = chars.find((c) => c.archetype === cast.lead.archetype);
  if (leadChar && (s.lead?.name !== leadChar.name || s.lead?.persona !== cast.lead.archetype))
    bad('lead', `must be {"persona": "${cast.lead.archetype}", "name": "${leadChar.name}"}`);
  if (typeof s.place !== 'string' || !s.place.trim()) bad('place', 'is required: the one place the whole comic happens');
  for (const [i, p] of (Array.isArray(s.panels) ? s.panels : []).entries())
    if (!p.background) bad(`panels[${i}].background`, `is required: decide ${PANEL_BACKGROUNDS.join(', ')}`);
  return out;
}

/**
 * The rest of the host's offer for the chosen genre: a meme the comic uses must
 * be one of the three offered, and an assigned style is drawn as assigned.
 */
export function offerProblems(s: ComicScript, opts: CheckOpts = {}): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  if (typeof s.genre !== 'string') return out;
  const option = opts.genreOptions?.find((g) => genreKey(g.id) === genreKey(s.genre!));
  if (!option) return out;
  if (option.pick) {
    // An isekai comic is the idea the judge picked: its anchor words, its meme (or none), and the players of any pitch it borrowed.
    const { idea, pitch } = option.pick;
    // The comic letters the brainstorm's anchor (anchorProblems then checks it's on the page).
    const want = option.pick.anchor?.terms ?? [];
    const has = Array.isArray(s.anchor?.terms) ? s.anchor!.terms.map((t) => String(t).toLowerCase()) : [];
    if (want.length && !want.some((t) => has.includes(t.toLowerCase())))
      out.push({ where: 'anchor.terms', problem: `must include the picked idea's anchor words (${want.map((t) => `"${t}"`).join(', ')}), lettered on the page` });
    if (pitch && s.pitch !== pitch.id) out.push({ where: 'pitch', problem: `must be "${pitch.id}" (the situation the picked idea borrows)` });
    if (!pitch && s.pitch) out.push({ where: 'pitch', problem: 'the picked idea borrows no pitch; leave pitch out' });
    if (s.gag !== idea.id) out.push({ where: 'gag', problem: `must be "${idea.id}" (the picked idea)` });
    if (idea.meme && s.meme !== idea.meme) out.push({ where: 'meme', problem: `must be "${idea.meme}" (attached to the picked idea)` });
    if (!idea.meme && s.meme) out.push({ where: 'meme', problem: 'the picked idea has no meme; leave meme out' });
    const onPage = new Set((Array.isArray(s.characters) ? s.characters : []).map((c) => c.archetype));
    for (const p of pitch?.players ?? [])
      if (!p.optional && !onPage.has(p.archetype))
        out.push({ where: 'characters', problem: `the pitch needs its ${p.slot}, "${p.title}" (${p.archetype}), on the page` });
  } else if (option.pitches?.length) {
    out.push({ where: 'genre', problem: 'this genre brainstorms first: write the ideas file, and the comic is written once an idea is picked (tracetoon comic gags)' });
  } else if (s.meme !== undefined && s.meme !== '') {
    const ids = [...(option.memeOffer ?? []), ...(option.tropeOffer ?? [])].map((m) => m.id);
    if (typeof s.meme !== 'string' || !ids.includes(s.meme))
      out.push({
        where: 'meme',
        problem: ids.length
          ? `"${String(s.meme)}" wasn't offered; use one of ${ids.join(', ')}, or leave meme out`
          : 'this genre offered no memes; leave meme out',
      });
  }
  if (option.assignedLayout) {
    // The host assigns a tiled structure per panel count, for variety; slants come from the panels' motion.
    const n = Array.isArray(s.panels) ? s.panels.length : 0;
    const want = option.assignedLayout[String(n)];
    const counts = Object.keys(option.assignedLayout).join(', ');
    if (!want) out.push({ where: 'panels', problem: `use ${counts} panels: this comic has an assigned layout for each (genreOptions assignedLayout)` });
    else if (s.composition?.family !== 'grid' || s.composition.signature !== want)
      out.push({ where: 'composition', problem: `with ${n} panels this comic's layout is {"family": "grid", "signature": "${want}"} (genreOptions assignedLayout)` });
  }
  const settingChoices = option.assignedSetting ? [option.assignedSetting] : (option.settingOffer ?? []);
  if (settingChoices.length || option.adventureOnly) {
    // The host assigns the adventure setting, offers three, or leaves it free (isekai/settings.ts); office places and bureaucracy jokes are out either way.
    const chosen = settingChoices.find((c) => c.id === s.setting);
    const assigned = chosen ?? settingChoices[0];
    const where = assigned ? settingById(assigned.id) : undefined;
    if (assigned && !chosen)
      out.push({ where: 'setting', problem: settingChoices.length === 1 ? `must be "${assigned.id}": this comic happens in ${assigned.label} (genreOptions assignedSetting)` : `must be one of ${settingChoices.map((c) => `"${c.id}"`).join(', ')}: the setting the PR's moment fits best (genreOptions settingOffer)` });
    if (typeof s.place === 'string' && s.place.trim()) {
      if (OFFICE_PLACE.test(s.place))
        out.push({ where: 'place', problem: `"${s.place}" is office-like (${s.place.match(OFFICE_PLACE)![0]}); no desks, counters, archives or paperwork rooms: ${assigned ? `set the scene in ${assigned.label}, e.g. ${assigned.examples.slice(0, 2).join(' or ')}` : 'set the scene where an adventure happens'}` });
      else if (assigned && where && !where.words.test(s.place))
        out.push({ where: 'place', problem: `"${s.place}" isn't in ${assigned.label}; name a spot there, e.g. ${assigned.examples.join(', ')}` });
    }
    // The payoff carries the PR (round 19): readers remember the last panel, so an anchor term is lettered there.
    const terms = Array.isArray(s.anchor?.terms) ? s.anchor!.terms.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
    const last = Array.isArray(s.panels) && s.panels.length > 1 ? (s.panels[s.panels.length - 1]?.dialogue ?? []).map((d) => loose(d.text ?? '')) : undefined;
    if (terms.length && last && !terms.some((t) => last.some((v) => v.includes(loose(t)))))
      // A warning since round 20: as an error it was met with re-lettered signs (35 of 40 final panels in r19).
      out.push({ where: 'anchor.terms', severity: 'warning', problem: `none of ${terms.map((t) => `"${t}"`).join(', ')} is in the last panel; the payoff is where the joke lands on the PR, so let the punchline itself turn on the change (not a sign re-lettering it)` });
    const joke = (Array.isArray(s.panels) ? pageText(s) : []).find((t) => OFFICE_JOKE.test(t));
    if (joke) out.push({ where: 'panels', problem: `"${joke}" is office parody (${joke.match(OFFICE_JOKE)![0]}); the PR plays out as adventure, not paperwork` });
  }
  if (option.assignedStyle && !opts.pinnedStyle && typeof s.style === 'string' && !same(s.style, option.assignedStyle))
    out.push({ where: 'style', problem: `this comic is assigned the style "${option.assignedStyle}" (genreOptions assignedStyle)` });
  return out;
}

/**
 * When the chosen genre came with a cast offer, the comic casts from it: the
 * host picks the five personas so a run of comics doesn't settle on the same
 * favourites. `personas` lists the offered ids used.
 */
export function personaProblems(s: ComicScript, opts: CheckOpts = {}): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  if (typeof s.genre !== 'string') return out;
  const option = opts.genreOptions?.find((g) => genreKey(g.id) === genreKey(s.genre!));
  const offer = option?.castOffer;
  const required = option?.requiredCast ?? offer?.personas.find((p) => p.required);
  const lead = option?.lead ?? offer?.personas.find((p) => p.lead);
  if (!offer && !required && !lead) return out;
  const allowed = [...(offer?.personas ?? []), ...(option?.requiredCast ? [option.requiredCast] : []), ...(option?.lead ? [option.lead] : [])];
  const offered = new Map(allowed.map((p) => [p.id, p]));
  const list = allowed.map((p) => `${p.id} (${p.role})`).join(', ');
  const personas = Array.isArray(s.personas) ? s.personas : [];
  if (!personas.length) {
    out.push({
      where: 'personas',
      problem: `is required: list the ids of the personas you cast${lead ? `, including the lead "${lead.name}" (${lead.id})` : ''}${required ? ` and "${required.name}" (${required.id})` : ''}${offer ? `, from ${list}` : ''}`,
    });
  } else {
    if (offer)
      for (const [i, id] of personas.entries()) {
        if (typeof id !== 'string' || !offered.has(id))
          out.push({
            where: `personas[${i}]`,
            problem:
              offer.kind === 'side-only'
                ? `"${String(id)}" wasn't offered; this comic uses side characters only: cast from ${list}`
                : `"${String(id)}" wasn't offered; cast from ${list}`,
          });
      }
    if (required && !personas.includes(required.id))
      out.push({ where: 'personas', problem: `this comic must cast "${required.name}" (${required.id}): ${required.details}` });
    if (offer && personas.length < 2)
      out.push({ where: 'personas', problem: 'cast at least two of the offered personas', severity: 'warning' });
  }
  if (lead) {
    const names = (s.characters ?? []).map((c) => c.name);
    if (!s.lead || typeof s.lead !== 'object' || s.lead.persona !== lead.id || typeof s.lead.name !== 'string')
      out.push({ where: 'lead', problem: `is required: {"persona": "${lead.id}", "name": "<their name in characters>"}; the main character is "${lead.name}": ${lead.details}` });
    else if (!names.includes(s.lead.name))
      out.push({ where: 'lead', problem: `"${s.lead.name}" isn't one of the characters (${names.join(', ')})` });
    else if (personas.length && !personas.includes(lead.id))
      out.push({ where: 'personas', problem: `list the lead persona "${lead.id}" too` });
    else {
      const panels = Array.isArray(s.panels) ? s.panels : [];
      const shown = panels.filter((p) => (p.characters ?? []).some((c) => c.name === s.lead!.name)).length;
      if (panels.length && shown * 2 < panels.length)
        out.push({ where: 'lead', problem: `the main character "${s.lead.name}" is in ${shown} of ${panels.length} panels; give them most of the page`, severity: 'warning' });
    }
  }
  return out;
}

/**
 * Names that belong to one specific work. Genre archetypes are welcome (a
 * starship captain, a wizard); a particular franchise's characters, ships and
 * trademarks are not, unless the user asked for them.
 */
export const FRANCHISE_NAMES =
  /\b(picard|kirk|spock|uss enterprise|starfleet|jedi|sith|lightsaber|darth|vader|skywalker|yoda|gandalf|frodo|hobbit|sauron|hogwarts|harry potter|pikachu|pok[eé]mon|mario|luigi|zelda|sonic the hedgehog|batman|superman|spider-?man|iron man|avengers|godzilla|gundam|evangelion|optimus|autobot|decepticon|doctor who|tardis|dalek|ghostbusters|indiana jones|james bond|007|sherlock|the terminator|ripley|xenomorph|mandalorian|borg|klingon|tribble|wookiee|chewbacca|r2-?d2|c-?3po|minecraft|master chief|pac-?man|frieren|himmel|konosuba|megumin|kazuma|re: ?zero|solo leveling|jinwoo|witch hat atelier|rimuru|ainz)\b/i;

export function franchiseProblems(s: ComicScript): ScriptProblem[] {
  if (s.request?.trim()) return [];
  const texts: [string, string | undefined][] = [
    ['genre', s.genre],
    ['title', s.title],
    ['synopsis', s.synopsis],
    ...(Array.isArray(s.characters) ? s.characters : []).flatMap(
      (c, i): [string, string | undefined][] => [
        [`characters[${i}].name`, c?.name],
        [`characters[${i}].description`, c?.description],
      ],
    ),
    ...(Array.isArray(s.panels) ? s.panels : []).flatMap((p, i) => [
      [`panels[${i}].scene`, p?.scene] as [string, string | undefined],
      ...(Array.isArray(p?.dialogue) ? p.dialogue : []).map(
        (d, j) => [`panels[${i}].dialogue[${j}].text`, d?.text] as [string, string | undefined],
      ),
    ]),
  ];
  return texts.flatMap(([where, text]) => {
    const hit = typeof text === 'string' ? FRANCHISE_NAMES.exec(text) : null;
    return hit
      ? [
          {
            where,
            problem: `"${hit[0]}" names a specific work's character, ship or trademark; generalize to the archetype (a starship captain, a wizard, a giant monster) unless the user asked for it`,
            severity: 'warning' as const,
          },
        ]
      : [];
  });
}

const SIDE = { left: 0, center: 1, right: 2 } as const;

/**
 * Balloons read from top-left, down and right, so the first speaker in a panel
 * stands on the left of (or level with) everyone who speaks after them;
 * otherwise a reply reads before the line it answers (Clip Studio Tips 4811,
 * Jim Shooter's lettering memo).
 */
export function balloonOrderProblems(s: ComicScript): ScriptProblem[] {
  const out: ScriptProblem[] = [];
  (Array.isArray(s.panels) ? s.panels : []).forEach((p, i) => {
    const where = new Map((p.characters ?? []).map((c) => [c.name, SIDE[c.position as keyof typeof SIDE]]));
    const speakers = (p.dialogue ?? []).flatMap((d) => (d.speaker && where.has(d.speaker) ? [d.speaker] : []));
    const order = speakers.filter((n, k) => speakers.indexOf(n) === k);
    for (let a = 0; a < order.length; a++)
      for (let b = a + 1; b < order.length; b++)
        if (where.get(order[a]!)! > where.get(order[b]!)!)
          out.push({
            where: `panels[${i}].characters`,
            problem: `${order[a]} speaks before ${order[b]} but stands to their right, so the reply reads first; put ${order[a]} on the left (swap their positions) or reorder the lines`,
          });
  });
  return out;
}

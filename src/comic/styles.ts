/**
 * Comic art styles. Every preset is a comic tradition (inks, color, lettering,
 * balloons, panels), because a PR comic should look like a comic, not an
 * illustration. A comic can also use the agent's own words, and an explicit
 * user request always wins. Reusing a style is fine when it suits the joke.
 */
import type { Palette, StyleFamily } from './types.ts';

export interface Style {
  id: string;
  name: string;
  /** The comic tradition, for the page summary. */
  family: StyleFamily;
  /** The style block for image prompts. */
  prompt: string;
  /** Palettes that suit it; the first is the default. */
  palettes: Palette[];
  /** Moods it is good at, to help pick. */
  moods: string[];
  /** Lettering direction for the image model. */
  lettering: string;
}

export const STYLES: Style[] = [
  {
    id: 'webcomic',
    name: 'Modern webcomic',
    family: 'webcomic',
    prompt:
      'modern webcomic, bold clean black ink outlines, bright cel-shaded color, very expressive cartoon faces and big reactions, simple readable backgrounds, crisp panel borders with white gutters',
    palettes: ['full-color'],
    moods: ['gag', 'relatable', 'everyday', 'any'],
    lettering:
      'bold hand-lettered comic font in white speech balloons, yellow caption boxes, punchy sound effects',
  },
  {
    id: 'superhero',
    name: 'American superhero',
    family: 'american',
    prompt:
      'modern American superhero comic book, dynamic foreshortened poses, confident inking with feathered shadows, rich digital coloring, dramatic lighting',
    palettes: ['full-color'],
    moods: ['heroic', 'rescue', 'big win', 'showdown', 'superhero', 'kaiju'],
    lettering:
      'uppercase comic-book lettering in oval balloons, bold caption boxes, big angular sound effects',
  },
  {
    id: 'silver-age',
    name: 'Silver Age comic',
    family: 'american',
    prompt:
      '1960s American comic book page, Ben-Day halftone dots, bold primary colors, thick inked outlines, melodramatic poses, slightly yellowed newsprint',
    palettes: ['full-color', 'limited'],
    moods: ['heroic', 'melodrama', 'retro', 'big claim'],
    lettering:
      'classic uppercase comic lettering in white balloons, exclamation-heavy, narration boxes',
  },
  {
    id: 'alt-comix',
    name: 'Indie alt-comix',
    family: 'indie',
    prompt:
      'indie alternative comic, loose expressive brush ink, slightly wobbly hand-drawn panel borders, flat muted colors, deadpan characters',
    palettes: ['limited', 'bw-accent'],
    moods: ['deadpan', 'awkward', 'dry humor', 'existential'],
    lettering: 'uneven hand-lettered capitals in simple balloons',
  },
  {
    id: 'shonen-action',
    name: 'Shonen manga',
    family: 'manga',
    prompt:
      'shonen manga page, energetic black ink, screentone shading, speed lines and impact frames, exaggerated reactions, dynamic camera angles',
    palettes: ['bw-accent', 'full-color'],
    moods: ['epic', 'battle', 'comeback', 'speed', 'rivalry', 'mecha'],
    lettering:
      'manga balloons with bold lettering, huge hand-drawn sound effects integrated into the art',
  },
  {
    id: 'manga-ink',
    name: 'Seinen manga',
    family: 'manga',
    prompt:
      'seinen manga page, detailed black ink linework, crosshatching and screentone, cinematic paneling, restrained, tense expressions',
    palettes: ['bw-accent', 'limited'],
    moods: ['tense', 'mystery', 'debugging', 'serious-as-a-joke'],
    lettering: 'clean manga lettering in balloons, sparse narration boxes',
  },
  {
    id: 'shojo',
    name: 'Shojo manga',
    family: 'manga',
    prompt:
      'shojo manga page, delicate fine linework, sparkle and flower screentones, big emotive eyes, soft pastel tones, panels that break their borders for emotional beats',
    palettes: ['limited', 'full-color'],
    moods: ['dramatic feelings', 'romance parody', 'wholesome', 'devotion'],
    lettering: 'elegant manga lettering, floating inner-monologue text, sparkly emphasis',
  },
  {
    id: 'chibi-anime',
    name: 'Chibi manga comedy',
    family: 'manga',
    prompt:
      'comedic chibi manga, super-deformed characters with big heads, sweat drops, anger marks and comic tears, simple screentone backgrounds, bold ink outlines',
    palettes: ['full-color', 'limited'],
    moods: ['silly', 'panic', 'small fix', 'cute'],
    lettering: 'rounded bubbly balloons, wobbly panic lettering',
  },
  {
    id: 'yonkoma',
    name: 'Yonkoma gag manga',
    family: 'manga',
    prompt:
      'yonkoma gag manga, clean simple ink linework, cute deformed characters, flat light tones, tidy rectangular panels',
    palettes: ['bw-accent', 'limited'],
    moods: ['gag', 'twist', 'everyday', 'deadpan'],
    lettering: 'small neat balloons, a quiet beat before the last-panel punchline',
  },
  {
    id: 'ligne-claire',
    name: 'Ligne claire',
    family: 'euro',
    prompt:
      'ligne claire European comic, clean uniform ink outlines, flat bright colors, detailed tidy backgrounds, no hatching',
    palettes: ['full-color'],
    moods: ['adventure', 'investigation', 'clever', 'travel'],
    lettering: 'neat hand lettering in clean rounded balloons',
  },
  {
    id: 'euro-humor',
    name: 'Franco-Belgian humor',
    family: 'euro',
    prompt:
      'Franco-Belgian humor comic, round bouncy cartoon characters with big noses, lively brush ink, bright flat colors, busy funny background details',
    palettes: ['full-color'],
    moods: ['slapstick', 'chaos', 'escalation', 'ensemble'],
    lettering:
      'lively hand lettering in rounded balloons, onomatopoeia drawn into the scene',
  },
  {
    id: 'sunday-strip',
    name: 'Sunday funnies',
    family: 'newspaper',
    prompt:
      'classic Sunday newspaper comic strip, simple expressive cartoon characters, warm flat colors, confident brush outlines, slight newsprint texture',
    palettes: ['full-color', 'limited'],
    moods: ['gag', 'everyday', 'relatable', 'small fix'],
    lettering: 'friendly hand-lettered balloons',
  },
  {
    id: 'editorial-cartoon',
    name: 'Editorial cartoon',
    family: 'newspaper',
    prompt:
      'newspaper editorial cartoon, scratchy pen-and-ink crosshatching, exaggerated original figures, words written on the objects that matter, single gray wash',
    palettes: ['bw-accent'],
    moods: ['commentary', 'irony', 'big picture', 'satire'],
    lettering:
      'hand-lettered words on objects in the scene, a short caption under the drawing',
  },
  {
    id: 'magazine-cartoon',
    name: 'Magazine gag cartoon',
    family: 'newspaper',
    prompt:
      'sophisticated magazine gag cartoon, loose confident pen line, light gray wash, understated deadpan characters',
    palettes: ['bw-accent'],
    moods: ['dry wit', 'understatement', 'one-liner'],
    lettering:
      'a single typeset caption beneath the drawing, set in quotes when someone speaks',
  },
  {
    id: 'webtoon',
    name: 'Full-color webtoon',
    family: 'webcomic',
    prompt:
      'full-color webtoon, clean digital lineart, soft gradient cel shading, glossy modern characters, big reaction close-ups, generous space between panels',
    palettes: ['full-color'],
    moods: ['drama', 'reaction', 'slow reveal', 'vertical'],
    lettering: 'clean digital balloons, oversized reaction text',
  },
  {
    id: 'saturday-cartoon',
    name: '90s Saturday-morning cartoon',
    family: 'american',
    prompt:
      '1990s Saturday-morning TV cartoon look drawn as a comic, thick outlines, angular stylized characters, saturated flat colors, squash-and-stretch expressions',
    palettes: ['full-color'],
    moods: ['zany', 'chaos', 'slapstick', 'villain plan'],
    lettering: 'chunky cartoon lettering in bold balloons, loud sound effects',
  },
  {
    id: 'noir',
    name: 'Noir graphic novel',
    family: 'american',
    prompt:
      'noir graphic novel, heavy black ink shadows, venetian-blind light, rain, chiaroscuro, trench coats',
    palettes: ['bw-accent', 'limited'],
    moods: ['mystery', 'debugging', 'investigation', 'confession', 'noir-detective', 'heist'],
    lettering: 'typewriter caption boxes with hard-boiled narration, tight balloons',
  },
  {
    id: 'space-opera',
    name: 'Space-opera comic',
    family: 'euro',
    prompt:
      'inked European science-fiction comic, clean confident line, bold flat colors, sweeping starships and alien vistas, detailed control panels, cinematic wide shots',
    palettes: ['full-color', 'limited'],
    moods: ['sci-fi', 'space', 'epic', 'space-opera', 'mission-control'],
    lettering:
      'clean uppercase comic lettering in white balloons, readouts on ship screens, bold sound effects',
  },
  {
    id: 'fantasy-adventure',
    name: 'Fantasy adventure comic',
    family: 'american',
    prompt:
      'inked fantasy adventure comic book, heroic poses, castles, dungeons and enchanted forests, rich flat coloring with dramatic torchlight',
    palettes: ['full-color'],
    moods: ['quest', 'fantasy', 'dungeon', 'fantasy-quest', 'dungeon-crawl'],
    lettering:
      'classic comic lettering in balloons, parchment caption boxes, carved-rune signs in the scene',
  },
  {
    id: 'anime-fantasy',
    name: 'Fantasy anime',
    family: 'manga',
    prompt:
      'full-color fantasy anime key frame, clean cel shading, expressive anime faces with sweat drops, sparkle eyes and comic reaction faces, depth of field: blurred painted backgrounds behind characters in dialogue panels and detailed scenery only in establishing shots, restrained glow that never competes with the lettering',
    palettes: ['full-color'],
    moods: ['fantasy', 'isekai', 'quest', 'cozy', 'level up', 'anime-fantasy'],
    lettering:
      'clean anime-style balloons, glowing fantasy status windows as captions, hand-drawn sound effects in the art',
  },
  {
    id: 'pixel-16bit',
    name: 'Pixel comic',
    family: 'webcomic',
    prompt:
      'pixel-art comic, crisp 16-bit pixels, clear panel borders, chunky expressive sprites, video-game UI framing',
    palettes: ['limited', 'full-color'],
    moods: ['quest', 'level up', 'boss fight', 'retro', 'retro-rpg', 'dungeon-crawl'],
    lettering: 'pixel-font RPG dialogue boxes',
  },
];

/**
 * Presets from earlier releases. Old scripts that name them still expand to
 * the same prompt; they are no longer offered or picked on reroll.
 */
const LEGACY_STYLES: Style[] = [
  [
    'mecha-anime',
    'mecha anime style, detailed robots and cockpits, holographic HUD panels, cinematic lighting',
    'HUD labels and readouts on screens, condensed sci-fi headline',
    ['full-color', 'bw-accent'],
  ],
  [
    'rubber-hose',
    '1930s rubber-hose cartoon, bendy limbs, pie-cut eyes, white gloves, sepia film grain, bouncy motion',
    'vintage title card lettering, bouncy balloons',
    ['limited', 'duotone'],
  ],
  [
    'storybook-watercolor',
    "children's storybook watercolor illustration, soft washes, pencil linework, gentle light",
    'handwritten storybook captions, whimsical headline',
    ['full-color'],
  ],
  [
    'claymation',
    'stop-motion claymation diorama, plasticine characters with fingerprints, miniature set, soft studio lighting',
    'cut-paper signs and labels in the set, chunky headline',
    ['full-color'],
  ],
  [
    'risograph',
    'risograph-printed zine, two overprinted ink colors, grainy texture, slight misregistration, bold shapes',
    'chunky grotesque type, stamped labels',
    ['duotone'],
  ],
  [
    'pulp-scifi',
    '1950s pulp science fiction magazine art, ray guns, rocket fins, painted gouache, dramatic sky',
    'pulp magazine cover headline, starburst blurbs',
    ['full-color', 'limited'],
  ],
  [
    'ukiyo-e',
    'Japanese ukiyo-e woodblock print, flat color areas, carved outlines, stylized waves and clouds, washi paper texture',
    'vertical cartouche labels, brush headline',
    ['limited'],
  ],
  [
    'atomic-flat',
    'mid-century modern illustration, atomic-age shapes, flat geometric characters, starbursts, cream background',
    'retro display type, small caption labels',
    ['limited', 'full-color'],
  ],
  [
    'blueprint',
    'technical blueprint, white linework on cyan blueprint paper, callouts, dimension lines, exploded views',
    'drafting stencil labels and callouts, title block headline',
    ['duotone'],
  ],
  [
    'vaporwave',
    'vaporwave aesthetic, neon pink and cyan, synthwave sun, chrome text, grid horizon, retro computer windows',
    'chrome and neon headline, window-title labels',
    ['full-color'],
  ],
].map(([id, prompt, lettering, palettes]) => ({
  id: id as string,
  name: id as string,
  family: 'custom' as StyleFamily,
  prompt: prompt as string,
  // The palettes each preset had, so old scripts keep their default palette.
  palettes: palettes as Palette[],
  moods: [],
  lettering: lettering as string,
}));

export const styleById = (id: string | undefined) =>
  STYLES.find((s) => s.id === id) ?? LEGACY_STYLES.find((s) => s.id === id);

/** Style presets other than `current`, least recently used first. */
export function freshStyles(recent: string[] = [], current?: string): Style[] {
  const pool = STYLES.filter((s) => s.id !== current);
  return [
    ...pool.filter((s) => !recent.includes(s.id)),
    ...pool.filter((s) => recent.includes(s.id)),
  ];
}

/** The style block for a prompt: a preset's tested prompt, or the text as written. */
export function styleText(style: string): string {
  return styleById(style)?.prompt ?? style.trim();
}

/** Lettering direction for a style: the preset's, or a neutral default. */
export function styleLettering(style: string): string {
  return (
    styleById(style)?.lettering ??
    'hand-lettered comic text in speech balloons and caption boxes that suits the art, easy to read at pull-request width'
  );
}

const NON_COMIC_MEDIUM =
  /\b(3d|cgi|render(ed)?|clay|claymation|plasticine|diorama|plush|toy|figurine|watercolou?r|gouache|oil paint|painted|picture[- ]book|storybook|photo(graph|real)?|stop[- ]motion|papercraft|paper[- ]cut)/i;

/**
 * Whether the style, or the user's explicit request, asks for a non-comic
 * medium (3D, clay, painting). Then the "must look like an inked comic" guard
 * is left out of the prompt, so it never contradicts what was asked for.
 */
export function wantsNonComicMedium(style: string, request?: string): boolean {
  return NON_COMIC_MEDIUM.test(styleText(style)) || NON_COMIC_MEDIUM.test(request ?? '');
}

/** How a palette reads in a prompt. */
export function paletteText(palette: Palette, accent?: string): string {
  switch (palette) {
    case 'bw-accent':
      return `black and white with a single accent color (${accent ?? 'red'}) used sparingly for emphasis`;
    case 'duotone':
      return `two-color print (${accent ? `black and ${accent}` : 'two inks'})`;
    case 'limited':
      return 'limited palette of 3 to 4 colors';
    default:
      return 'full color';
  }
}

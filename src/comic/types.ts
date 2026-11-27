/**
 * The comic's data: one page brief per PR. Each comic invents its own
 * characters and picks its own art direction. Only compact creative choices
 * are read back to notice repetition; characters are never carried forward.
 */

export type Beat = 'ki' | 'sho' | 'ten' | 'ketsu';
export const BEATS: Beat[] = ['ki', 'sho', 'ten', 'ketsu'];
export const BEAT_MEANING: Record<Beat, string> = {
  ki: 'setup',
  sho: 'development',
  ten: 'twist',
  ketsu: 'resolution',
};

export type Expression =
  | 'happy'
  | 'excited'
  | 'worried'
  | 'surprised'
  | 'determined'
  | 'thinking'
  | 'sleepy'
  | 'proud'
  | 'angry';
export const EXPRESSIONS: Expression[] = [
  'happy',
  'excited',
  'worried',
  'surprised',
  'determined',
  'thinking',
  'sleepy',
  'proud',
  'angry',
];

/** A character invented for this comic. */
export interface Character {
  /** How panels and dialogue refer to it, and the name in the transcript. */
  name: string;
  /** What it looks like, for the image model. */
  description: string;
  /** Creative category, not an identity inferred from the description. */
  kind?: CastKind;
}

export type CastKind = 'human' | 'creature' | 'object';
export const CAST_KINDS: CastKind[] = ['human', 'creature', 'object'];
/** Comic traditions. The older visual families are still read from past PRs. */
export const STYLE_FAMILIES = [
  'webcomic',
  'american',
  'manga',
  'euro',
  'newspaper',
  'indie',
  'custom',
] as const;
export const LEGACY_STYLE_FAMILIES = [
  'ink',
  'flat-color',
  'painted',
  'print',
  'dimensional',
  'pixel',
  'technical',
] as const;
export type StyleFamily =
  (typeof STYLE_FAMILIES)[number] | (typeof LEGACY_STYLE_FAMILIES)[number];
export const KNOWN_STYLE_FAMILIES: readonly StyleFamily[] = [
  ...STYLE_FAMILIES,
  ...LEGACY_STYLE_FAMILIES,
];
export const LAYOUT_FAMILIES = [
  'single',
  'comparison',
  'sequence',
  'vertical',
  'asymmetric',
  'hero-inset',
  'diagonal',
  'tiered',
  'slanted',
  'splash',
  'staggered',
  'custom',
] as const;
export type LayoutFamily = (typeof LAYOUT_FAMILIES)[number];
export type TitleMode = 'none' | 'integrated' | 'heading';
/** Coordinates are fractions of the page, before the branding footer. */
export interface FrameBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PanelFrame extends FrameBounds {
  /** Polygon points in the frame's own 0–1 space. */
  clip?: [number, number][];
  border?: 'line' | 'none';
  /** Safe lettering area in the frame's own 0–1 space. Required for polygon dialogue. */
  textBox?: FrameBounds;
  /** This later frame deliberately sits inside an earlier frame. */
  inset?: boolean;
  /** A figure or effect in this panel bursts over the panel border. */
  breakout?: boolean;
}
export interface Composition {
  family: LayoutFamily;
  /** In story/reading order. Omit to use the family's geometry (except custom). */
  frames?: PanelFrame[];
  title: { mode: TitleMode; box?: FrameBounds };
}
/** Only these compact creative choices are read back from published PRs. */
export interface ComicSummary {
  style?: string;
  /** The world it is set in: a genre id (genres.ts) or a short custom phrase. */
  genre?: string;
  styleFamily?: StyleFamily;
  layoutFamily?: LayoutFamily;
  panelCount?: number;
  titleTreatment?: TitleMode;
  /** Missing means unknown; [] means deliberately characterless. */
  castKinds?: CastKind[];
  /** The comic's invented character names, lowercased: later comics pick new ones. */
  castNames?: string[];
}

/** A character's place in one panel. */
export interface PanelCharacter {
  /** A name from the comic's `characters`. */
  name: string;
  position: 'left' | 'center' | 'right';
  expression?: Expression;
  pose?: string;
}

export const DIALOGUE_KINDS = [
  'speech',
  'thought',
  'caption',
  'sfx',
  'sign',
  'label',
] as const;
export type DialogueKind = (typeof DIALOGUE_KINDS)[number];

/**
 * The balloon's shape, which carries how a line is said: `shout` and `burst`
 * spiky, `whisper` dashed, `thought` a cloud, `radio` jagged for screens,
 * comms and machines. Plain `speech` when omitted.
 */
export const BALLOONS = ['speech', 'shout', 'burst', 'whisper', 'thought', 'radio'] as const;
export type Balloon = (typeof BALLOONS)[number];
/** How big a sound effect is drawn. */
export const SFX_SIZES = ['small', 'big', 'huge'] as const;
export type SfxSize = (typeof SFX_SIZES)[number];
/** Drawn effects that show motion, force and feeling. */
export const PANEL_EFFECTS = [
  'speed-lines',
  'impact-burst',
  'focus-lines',
  'motion-blur',
  'emanata',
  'shake',
] as const;
export type PanelEffect = (typeof PANEL_EFFECTS)[number];
export const CAMERAS = [
  'wide',
  'medium',
  'close',
  'extreme-close',
  'low-angle',
  'high-angle',
  'overhead',
  'dutch',
  'over-shoulder',
  'silhouette',
] as const;
export type Camera = (typeof CAMERAS)[number];

export interface Dialogue {
  /** A character's name, or "caption" for narration (also used for signs, screens and labels). */
  speaker: string;
  /** Exact words. With model lettering they are drawn into the art verbatim. */
  text: string;
  /**
   * `sign`: words that are part of the scene: on a screen, a mug, a box, a
   * door, a T-shirt. Name that surface in `points`.
   * `label`: deprecated pointer tag; drawn as words on the element it names.
   */
  kind?: DialogueKind;
  /** For a `sign`: the surface the words are written on (legacy `label`: the element). */
  points?: string;
  /** Balloon shape for spoken lines; omitted means a plain speech balloon. */
  balloon?: Balloon;
  /** Words from `text` to letter bold or larger. */
  emphasis?: string[];
  /** For `sfx`: how big it is drawn. */
  size?: SfxSize;
}

/** One drawn element and the real thing in the PR it stands for. */
export interface AnchorMapping {
  visual: string;
  technical: string;
}

/**
 * What ties the comic to the PR. Local art direction: never posted.
 * At least one term must be readable in the art.
 */
export interface ComicAnchor {
  /** One sentence: the concrete change this PR makes. */
  change: string;
  /** 1–4 real names from the PR: a command, flag, file, error or concept. */
  terms: string[];
  /** Which drawn elements stand for which technical things. */
  mapping: AnchorMapping[];
}

export interface Panel {
  /** Optional story beat. */
  beat?: Beat;
  /** What the panel shows, in a sentence. */
  scene: string;
  camera?: Camera;
  /** Drawn effects: speed lines, an impact burst, sweat drops, a shaking frame. */
  effects?: PanelEffect[];
  characters: PanelCharacter[];
  dialogue: Dialogue[];
  /** Optional extra direction for image models. */
  artPrompt?: string;
  /**
   * What the finished art actually shows, when it differs from `scene`. Used
   * for the transcript only; never sent to the image model, so correcting it
   * doesn't make the art stale.
   */
  drawn?: string;
}

export type Aspect = '4:3' | '1:1' | '16:9' | '3:4';
export const ASPECTS: Aspect[] = ['4:3', '1:1', '16:9', '3:4'];

export type Palette = 'full-color' | 'bw-accent' | 'duotone' | 'limited';
export const PALETTES: Palette[] = ['full-color', 'bw-accent', 'duotone', 'limited'];

/**
 * The comic: a page brief. A format and layout the agent chooses, 1-6 panels,
 * characters made up for this PR, any art style, and text the image model
 * letters into the art.
 */
export interface ComicScript {
  v: 2;
  /** Comic title (used in the PR and the transcript). */
  title: string;
  /** The big title drawn into the art; up to 6 words. Defaults to `title`. */
  headline?: string;
  /** A format id from formats.ts, or "custom". */
  format: string;
  /** How the page is composed, in the agent's words. */
  layout?: string;
  /** Shared geometry for model lettering and overlay lettering; absent means legacy layout. */
  composition?: Composition;
  /** A broad visual family so renaming a style does not disguise repetition. */
  styleFamily?: StyleFamily;
  /** Local art-direction rationale; never included in public PR metadata. */
  designReason?: string;
  /** The change, real terms and visual mapping. Required with `composition`. */
  anchor?: ComicAnchor;
  /** Page shape. Default: the format's. */
  aspect?: Aspect;
  /** Any art style: a comic preset from styles.ts by id, or the agent's own description. */
  style: string;
  /**
   * The world the comic is set in, chosen first: a genre id from genres.ts
   * (offered in context.comic.genreOptions) or a short custom phrase.
   * Required for composed scripts.
   */
  genre?: string;
  /**
   * What the user explicitly asked to see (a style, characters, a theme), in
   * their words. Sent to the image model as the user's request; it overrides
   * Tracetoon's own defaults, such as original-character designs.
   */
  request?: string;
  /** Color treatment. Default: the style's first palette, or full color. */
  palette?: Palette;
  /** One accent color for `bw-accent` / `duotone`, e.g. "red". */
  accent?: string;
  /** Who appears, invented for this comic (may be empty). */
  characters: Character[];
  /** One or two sentences: what this comic is about (the share caption). */
  synopsis: string;
  /** Describes the whole comic for screen readers. */
  altText: string;
  panels: Panel[];
}

/**
 * The Agent Skills Tracetoon ships. The main skill carries the runtime; each
 * sibling is instructions only and is installed beside it, in the same skills
 * folder (`join(dirname(mainDir), name)`).
 */
export const MAIN_SKILL = 'tracetoon';

/** Writes one PR comic's script from a Tracetoon comic packet (a subagent's skill). */
export const DRAW_CARTOON_SKILL = 'tracetoon-draw-cartoon';

export const SIBLING_SKILLS = [DRAW_CARTOON_SKILL] as const;

/** The main skill's comic references the draw-cartoon skill ships a copy of. */
export const DRAW_CARTOON_REFERENCES = [
  'comic-guide.md',
  'comic-direction.md',
  'genres.md',
  'styles.md',
] as const;

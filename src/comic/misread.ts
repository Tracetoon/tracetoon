/**
 * The misread review: before a comic is published, a fresh reviewer looks at
 * the finished image only and asks what it could look like to a large, varied
 * audience at a glance, not what it was meant to show. A prop, machine part,
 * shadow or gesture that reads as sexual, genital, obscene, a rude gesture or
 * a hate symbol sends the comic back to drawing with that item to avoid; after
 * two redraws that still raise a concern, the comic is skipped.
 */

export const MISREAD_PROMPT = `You review a finished comic image before it is posted at the top of a GitHub pull request, seen by a large and varied professional audience. Look at it the way a stranger would in the first few seconds, ignoring what the artist meant to draw.

Report only these readings:
- sexual, genital or anatomical: a rod, lever, stick, piston, nozzle, plunger, hilt, tentacle, finger or stalk whose shape, angle or placement (especially at or near someone's groin or lap, or gripped there) suggests a penis; paired round shapes that suggest breasts or buttocks; poses or overlaps that suggest sexual contact or groping;
- a rude gesture: a raised middle finger or crude hand sign;
- a hate symbol or extremist insignia: swastika-like shapes, salutes.
Ignore everything else (violence, drawing mistakes, gross-out humor, colors that resemble blood).

For each reading, judge how likely an ordinary viewer is to see it at a glance: "likely" when many would see it right away, "possible" when only a viewer looking for it would. Panels are numbered in reading order.

Reply only with JSON: {"state": "clear" | "concern", "items": [{"panel": number, "what": "the element as drawn", "couldReadAs": "what it could be taken for", "likelihood": "likely" | "possible", "fix": "how to redraw it so it can't be read that way"}]}. Set state to "concern" only when at least one item is likely; otherwise "clear" (listing any possible items).`;

export const MISREAD_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['clear', 'concern'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          panel: { type: 'number' },
          what: { type: 'string' },
          couldReadAs: { type: 'string' },
          likelihood: { type: 'string', enum: ['likely', 'possible'] },
          fix: { type: 'string' },
        },
        required: ['panel', 'what', 'couldReadAs', 'likelihood', 'fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['state', 'items'],
  additionalProperties: false,
} as const;

export interface MisreadItem {
  panel: number;
  what: string;
  couldReadAs: string;
  likelihood?: 'likely' | 'possible';
  fix: string;
}

export interface MisreadReview {
  state: 'clear' | 'concern';
  items: MisreadItem[];
}

/**
 * Readings too harmful to publish even when only a viewer looking for them
 * would see them: hate symbols and rude gestures (a "possible" swastika-like
 * fitting was published in round 19). Sexual readings keep the "likely" bar.
 */
export const SEVERE_READING = /swastika|nazi|hate symbol|extremis|insignia|white power|ss rune|sieg|salute|middle finger|rude gesture|obscene gesture/i;
const severe = (i: MisreadItem) => SEVERE_READING.test(`${i.couldReadAs} ${i.what}`);

/** Whether a review sends the comic back: a likely reading, or any severe one (an older review without likelihoods counts every item). */
export function hasConcern(review: MisreadReview): boolean {
  return (review.state === 'concern' && review.items.some((i) => i.likelihood !== 'possible')) || review.items.some(severe);
}

/** Redraws a comic gets after a concern before it is skipped. */
export const MISREAD_REDRAWS = 2;

export function isMisreadReview(v: unknown): v is MisreadReview {
  const r = v as MisreadReview;
  return (
    !!r &&
    (r.state === 'clear' || r.state === 'concern') &&
    Array.isArray(r.items) &&
    r.items.every((i) => typeof i?.what === 'string' && typeof i?.couldReadAs === 'string' && typeof i?.fix === 'string')
  );
}

/** What the next drawing must avoid, from a review's items (added to the script's `avoid`). */
export function avoidFrom(review: MisreadReview): string[] {
  return review.items.filter((i) => i.likelihood !== 'possible' || severe(i)).map((i) => `${i.what} drawn so it could read as ${i.couldReadAs}; instead ${i.fix}`.slice(0, 240));
}

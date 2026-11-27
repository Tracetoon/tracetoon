/**
 * How a non-human archetype is drawn, checked against the source series:
 * the base body (most anime "-folk", demons and ogres are humans with a few
 * traits) and the visible traits on it. Species labels such as "lizardfolk"
 * read as animal-headed creatures to an image model, so the image prompt gets
 * the base body and the traits, never the label, and an avoid-list of what
 * must not be added.
 *
 * Audited 2026-11-26 against the anchor characters' canonical appearance
 * (presentation.json lists the sources and a confidence per archetype).
 */
import data from './presentation.json' with { type: 'json' };

export type Base = 'human' | 'humanoid creature' | 'creature' | 'dual';

export interface Presentation {
  base: Base;
  /** Visible attributes on the base body, as design facts. */
  presentation: string;
  /** What an image model must not add (an animal snout, a fully scaled face…). */
  notOnPage: string[];
  /** The recipe's look, corrected where it claimed what the sources don't show. */
  look?: string;
  /** The recipe's core and variants, where the guide's wording contradicts the body ("reptilian-looking", "lizardfolk"). */
  core?: string;
  variants?: string[];
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
}

const PRESENTATIONS = data as Record<string, Presentation>;

export function presentationOf(archetype: string | undefined): Presentation | undefined {
  return archetype ? PRESENTATIONS[archetype] : undefined;
}

/** Species words that turn a human-presenting character into a creature in the image. */
export const SPECIES_WORDS = /\b(?:[a-z]+folk|lizard(?:wo)?m[ae]n|beast(?:wo)?m[ae]n|cat(?:wo)?m[ae]n|dog(?:wo)?m[ae]n|wolf(?:wo)?m[ae]n|kemonomimi|anthro(?:pomorphic)?)\b/i;

/** The words the image prompt adds after a human-based character's description. */
export function bodyNote(archetype: string | undefined): string | undefined {
  const p = presentationOf(archetype);
  if (!p) return undefined;
  if (p.base === 'human') return 'a human face and body, with only the traits described';
  if (p.base === 'dual') return 'in the form described, with only the traits described';
  return undefined;
}

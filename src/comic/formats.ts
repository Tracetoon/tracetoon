/**
 * Page formats. The agent picks the one that makes the best image for this PR;
 * `custom` lets it describe its own layout.
 */
import type { Aspect } from './types.ts';

export interface Format {
  id: string;
  name: string;
  /** When it works best. */
  useWhen: string;
  /** A layout sketch for the image model; the agent's `layout` refines it. */
  layout: string;
  panels: [min: number, max: number];
  aspect: Aspect;
}

export const FORMATS: Format[] = [
  {
    id: 'strip',
    name: 'Gag strip',
    useWhen: 'a joke told in beats: setup, build, punchline',
    layout:
      'a horizontal row of panels read left to right; the last panel lands the punchline',
    panels: [3, 4],
    aspect: '16:9',
  },
  {
    id: 'tiered-strip',
    name: 'Tiered page',
    useWhen: 'a scene that needs establishing first, then quick beats to the punchline',
    layout:
      'a wide establishing panel across the top, then a row of 2 to 4 smaller panels below it; the last one lands the joke',
    panels: [3, 5],
    aspect: '4:3',
  },
  {
    id: 'manga-page',
    name: 'Manga page',
    useWhen: 'escalation or a dramatic overreaction: quick beats into one big reaction',
    layout:
      'a manga page with irregular, slanted panels of different sizes; small fast beats lead into one dominant reaction panel',
    panels: [3, 6],
    aspect: '3:4',
  },
  {
    id: 'webtoon',
    name: 'Vertical webtoon',
    useWhen: 'a slow reveal or a pause before the punchline: read top to bottom',
    layout:
      'a vertical scroll of 3 to 5 stacked wide panels with space between them for timing; the last panel is the payoff',
    panels: [3, 5],
    aspect: '3:4',
  },
  {
    id: '4koma',
    name: '4-koma',
    useWhen: 'a story with a clear twist: setup, development, twist, resolution',
    layout: 'four panels: setup, development, twist, resolution',
    panels: [4, 4],
    aspect: '4:3',
  },
  {
    id: 'before-after',
    name: 'Before / after',
    useWhen:
      'only when the contrast itself is the punchline; most changes make a better joke as a story',
    layout:
      'split page: BEFORE on the left, AFTER on the right',
    panels: [2, 3],
    aspect: '16:9',
  },
  {
    id: 'splash',
    name: 'Splash page',
    useWhen: 'one big moment says it all: a launch, a rescue, a victory',
    layout:
      'one full-page scene with a huge headline',
    panels: [1, 2],
    aspect: '4:3',
  },
  {
    id: 'mission-briefing',
    name: 'Mission briefing',
    useWhen: 'a tricky multi-part fix: objectives, obstacles, outcome',
    layout:
      'a briefing board: a large hero panel plus 2 to 4 numbered mission cards with short labels',
    panels: [3, 5],
    aspect: '4:3',
  },
  {
    id: 'movie-poster',
    name: 'Movie poster',
    useWhen: 'a big feature or a dramatic rescue that deserves a blockbuster',
    layout:
      'a movie poster: the cast posed heroically, a title treatment, a tagline, and a credits block of short labels',
    panels: [1, 1],
    aspect: '3:4',
  },
  {
    id: 'manual-page',
    name: 'Instruction manual',
    useWhen: 'a new workflow or setup: show the steps',
    layout:
      'a flat-pack instruction manual page: 3 to 6 numbered steps with simple pictures and tiny labels',
    panels: [3, 6],
    aspect: '4:3',
  },
  {
    id: 'newspaper-sunday',
    name: 'Sunday funnies',
    useWhen: 'an everyday, relatable story with a few beats',
    layout:
      'a Sunday comics page: a title banner, then panels of varied widths in two rows',
    panels: [4, 6],
    aspect: '4:3',
  },
  {
    id: 'trading-card',
    name: 'Trading card',
    useWhen: 'a new capability or tool: show its stats and powers',
    layout:
      'a collectible trading card: a framed character portrait, a name plate, 2 to 3 ability lines and a stats box',
    panels: [1, 1],
    aspect: '3:4',
  },
  {
    id: 'custom',
    name: 'Custom',
    useWhen: 'none of the above fits: describe the page in `layout`',
    layout: '',
    panels: [1, 6],
    aspect: '4:3',
  },
];

export const formatById = (id: string | undefined) => FORMATS.find((f) => f.id === id);

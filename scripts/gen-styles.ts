/** Writes the skill's styles.md from src/comic/styles.ts (run: bun scripts/gen-styles.ts). */
import { writeFileSync } from 'node:fs';
import { STYLES } from '../src/comic/styles.ts';
const rows = STYLES.map(
  (s) =>
    `| \`${s.id}\` | ${s.name} | ${s.family} | ${s.moods.join(', ')} | ${s.palettes.join(', ')} |`,
);
const md = `# Comic styles

Every comic should look like a drawn comic. Set \`"style"\` to one of these
ids (it expands to a tested prompt) or name a comic tradition in your own
words ("90s alt-weekly strip", "gag manga with screentone"). Pick what suits
this PR's joke; reusing a recent style is fine. If the user asked for a
specific look or characters, use their words in \`"request"\` and honor them.

These lettering notes suggest a treatment, not a mandatory headline.
\`composition.title\` decides whether a title is drawn and where it belongs.

| Style | Look | Family | Good for | Palettes |
|---|---|---|---|---|
${rows.join('\n')}

Details (what the image model is asked for):

${STYLES.map((s) => `- **\`${s.id}\`**: ${s.prompt}. Lettering: ${s.lettering}.`).join('\n')}

Palettes: \`full-color\`; \`bw-accent\` (black and white with one accent color,
set \`"accent"\`, e.g. "red"); \`duotone\` (two inks); \`limited\` (3 to 4 colors).
`;
export const STYLES_MD = md;
if (import.meta.main)
  writeFileSync(
    process.argv[2] ??
      new URL('../plugin/skills/tracetoon/references/styles.md', import.meta.url),
    md,
  );

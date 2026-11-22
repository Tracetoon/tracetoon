/** Writes the skill's genres.md from src/comic/genres.ts (run: bun scripts/gen-genres.ts). */
import { writeFileSync } from 'node:fs';
import { GENRES } from '../src/comic/genres.ts';

const md = `# Comic genres

Pick the genre **first**, before the joke. \`tracetoon prepare\` offers three
in \`context.comic.genreOptions\`: the ones this repo used least recently,
shuffled per branch. Choose the one where this PR's real moment maps most
naturally onto the genre's stakes, set \`"genre"\` to its id (or a short phrase
of your own for a genre not listed), then find the joke inside that world.
\`tracetoon comic check\` refuses a genre used by either of the repo's last two
comics, unless the user asked for it (\`"request"\`) or the repo pins one
(\`config genre\`).

Draw genre **archetypes**, not a particular work: a grizzled starship captain
in a generic uniform is fine; a specific show's captain, insignia or ship is
not. Generalize to the class.

${GENRES.map(
  (g) => `## \`${g.id}\`: ${g.name}

- **Setting:** ${g.setting}
- **Archetypes:** ${g.archetypes.join('; ')}
- **Props that carry the PR's words:** ${g.props.join('; ')}
- **Joke hooks:** ${g.jokeHooks.join('; ')}
- **Styles that suit it:** ${g.styles.map((s) => `\`${s}\``).join(', ')}
`,
).join('\n')}`;
export const GENRES_MD = md;
if (import.meta.main)
  writeFileSync(
    process.argv[2] ??
      new URL('../plugin/skills/tracetoon/references/genres.md', import.meta.url),
    md,
  );

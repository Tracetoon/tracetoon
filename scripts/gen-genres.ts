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

**Parody the trope, not the property.** Evoke the familiar settings and
character types of a genre's famous works (a cantina of odd aliens, an away
team on a painted planet, a masked dark lord); never name the work or its
characters, and never copy a specific character's design, insignia or ship.

**Your own genres.** Users and repos add genres as genre files, and
\`genreOptions\` offers them alongside the ones below (an option's \`notes\` is
extra direction from its author). A genre file is Markdown in
\`<config dir>/genres/\` (beside Tracetoon's \`config.json\`) or the repo's
\`.github/tracetoon/genres/\`; a repo genre replaces a user or built-in one with
the same id. \`tracetoon genre list\` shows every genre and where it came from;
\`tracetoon genre check <file>\` validates one:

\`\`\`markdown
---
id: build-pirates
name: Build pirates
setting: a leaky galleon in a storm of failing builds
archetypes:
  - one-eyed captain
  - parrot that repeats log lines
props:
  - treasure map
  - flag on the mast
jokeHooks:
  - the treasure is a green check
styles:
  - webcomic
---
Optional notes for the comic author.
\`\`\`

**A persona roster (optional).** A genre file can add a \`cast:\` list of up to
48 personas, each written \`role: name — details\` with the role one of hero,
mage, warrior, healer, scout, nemesis or side. The author never sees the whole
roster: each comic's \`genreOptions\` entry carries a \`castOffer\` of five,
picked by seed (usually three main-cast roles, a nemesis and a side character;
about one comic in five gets side characters only). Cast from those five and
list their ids in the script's \`personas\`; \`comic check\` rejects any other.

${GENRES.map(
  (g) => `## \`${g.id}\`: ${g.name}

- **Setting:** ${g.setting}
- **Archetypes:** ${g.archetypes.join('; ')}
- **Props that carry the PR's words:** ${g.props.join('; ')}
- **Joke hooks:** ${g.jokeHooks.join('; ')}
- **Styles that suit it:** ${g.styles.map((s) => `\`${s}\``).join(', ')}
${g.cast?.length ? `- **Cast:** a roster of ${g.cast.length} personas; each comic is offered five in \`castOffer\`. Cast from those.\n` : ''}`,
).join('\n')}`;
export const GENRES_MD = md;
if (import.meta.main)
  writeFileSync(
    process.argv[2] ??
      new URL('../plugin/skills/tracetoon/references/genres.md', import.meta.url),
    md,
  );

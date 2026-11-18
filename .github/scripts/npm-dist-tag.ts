/**
 * The npm dist-tag a release publishes to. A final version goes to `latest`.
 * A release candidate goes to `next` once a final version exists; before that
 * it goes to `latest`, so `npx tracetoon@latest` (what the install docs use)
 * gets the newest release without anyone moving the tag by hand. Trusted
 * publishing can publish but not change dist-tags afterwards.
 */
export function npmDistTag(version: string, published: string[]): 'latest' | 'next' {
  if (!version.includes('-')) return 'latest';
  return published.some((v) => !v.includes('-')) ? 'next' : 'latest';
}

/** `npm view <pkg> versions --json` prints an array, or a bare string for one version. */
export function parsePublished(json: string): string[] {
  if (!json.trim()) return [];
  const value: unknown = JSON.parse(json);
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  throw Error('Expected the output of npm view <package> versions --json.');
}

if (import.meta.main) {
  const [version, published = ''] = process.argv.slice(2);
  if (!version)
    throw Error('Use: npm-dist-tag.ts <version> [<npm view versions --json>]');
  console.log(npmDistTag(version, parsePublished(published)));
}

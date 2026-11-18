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

/**
 * Reads `npm view <pkg> versions --json`: an array, or a bare string for one
 * version. A package that doesn't exist yet prints an E404 error object, which
 * means nothing is published. Any other output (another error, a network
 * failure) throws, so a failed lookup never passes for "no final version yet".
 */
export function parsePublished(json: string): string[] {
  const value: unknown = json.trim() ? JSON.parse(json) : undefined;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  if ((value as { error?: { code?: unknown } } | undefined)?.error?.code === 'E404')
    return [];
  throw Error(
    'Could not read the published versions from npm view <package> versions --json.',
  );
}

if (import.meta.main) {
  const [version, published] = process.argv.slice(2);
  if (!version)
    throw Error('Use: npm-dist-tag.ts <version> <npm view versions --json output>');
  // No output at all (npm itself failed) throws too.
  console.log(npmDistTag(version, parsePublished(published ?? '')));
}

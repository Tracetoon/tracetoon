import { expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const LIMIT = 5 * 1024 * 1024;

// The Claude plugin directory refuses a plugin with any file over 5 MiB in the
// plugin folder, or in a .gitattributes or package-manager file above it.
test('no file in the plugin folder is over 5 MiB', () => {
  const big: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile() && statSync(path).size > LIMIT) big.push(relative(root, path));
    }
  };
  walk(join(root, 'plugin'));
  for (const name of ['.gitattributes', 'package.json', 'bun.lock'])
    if (statSync(join(root, name)).size > LIMIT) big.push(name);
  expect(big).toEqual([]);
});

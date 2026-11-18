import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

// The Claude plugin directory refuses a plugin whose .gitattributes could
// change line endings on install: every text/eol/crlf rule must say eol=lf,
// and .cmd files are stored byte for byte instead (-text).
test('.gitattributes sets no line ending other than LF', () => {
  const rules = readFileSync(join(root, '.gitattributes'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const rule of rules) {
    const attrs = rule.split(/\s+/).slice(1);
    const setsEndings = attrs.some((a) => /^(text|eol|crlf)(=|$)/.test(a));
    if (setsEndings)
      expect({ rule, lf: attrs.includes('eol=lf') }).toEqual({ rule, lf: true });
  }
  expect(rules).toContain('*.cmd -text');
});

test('the Windows launcher is stored with CRLF line endings', () => {
  const text = readFileSync(
    join(root, 'plugin/skills/tracetoon/bin/tracetoon.cmd'),
    'utf8',
  );
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replace(/\r\n/g, '')).not.toContain('\n');
});

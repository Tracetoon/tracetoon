/**
 * Keeps the draw-cartoon skill's references in step with the main skill's
 * comic references, which stay the source (they link only to each other).
 * Run: bun scripts/draw-cartoon-skill.ts [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAW_CARTOON_REFERENCES, DRAW_CARTOON_SKILL, MAIN_SKILL } from '../src/skills.ts';

const root = join(import.meta.dir, '..');
export const MAIN_DIR = join(root, 'plugin', 'skills', MAIN_SKILL);
export const DRAW_CARTOON_DIR = join(root, 'plugin', 'skills', DRAW_CARTOON_SKILL);

const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** The draw-cartoon skill's references as they should be: `references/<name>` -> text. */
export function drawCartoonReferences(): Map<string, string> {
  return new Map(
    DRAW_CARTOON_REFERENCES.map((name) => [
      `references/${name}`,
      lf(readFileSync(join(MAIN_DIR, 'references', name), 'utf8')),
    ]),
  );
}

/** Reference copies that are missing or differ from the main skill's. */
export function staleDrawCartoon(): string[] {
  return [...drawCartoonReferences()]
    .filter(([path, text]) => {
      const file = join(DRAW_CARTOON_DIR, path);
      return !existsSync(file) || lf(readFileSync(file, 'utf8')) !== text;
    })
    .map(([path]) => `plugin/skills/${DRAW_CARTOON_SKILL}/${path}`);
}

export function writeDrawCartoon(): void {
  mkdirSync(join(DRAW_CARTOON_DIR, 'references'), { recursive: true });
  for (const [path, text] of drawCartoonReferences())
    writeFileSync(join(DRAW_CARTOON_DIR, path), text);
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    const stale = staleDrawCartoon();
    if (stale.length) {
      console.error(`Stale: ${stale.join(', ')}. Run: bun scripts/draw-cartoon-skill.ts`);
      process.exit(1);
    }
  } else writeDrawCartoon();
}

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comicSkillFiles, DRAW_CARTOON_SKILL } from '../src/commands/comicPacket.ts';
import { genreOptions } from '../src/comic/genres.ts';
import { comicPacketFiles, PACKET_FILES } from '../src/comic/packet.ts';
import { EXPRESSIONS } from '../src/comic/types.ts';
import { tempDir } from './helpers.ts';
import { DRAW_CARTOON_DIR, staleDrawCartoon } from '../scripts/draw-cartoon-skill.ts';

const input = () => ({
  brief: 'changes[1]: CH1 adds a retry\n',
  description: 'Adds a retry with backoff.\n',
  genres: genreOptions([], { pinned: 'kaiju' }),
  skillFiles: ['/skills/tracetoon-draw-cartoon/SKILL.md'],
  patchPath: '/run/changes.patch',
  out: { comic: '/run/comic.json', design: '/run/comic-design.json' },
  checkCommand: 'tracetoon comic check --run r1',
});

describe('comic author packet', () => {
  test('holds the brief, the description and the genre choices, and points at the skill', () => {
    const files = comicPacketFiles(input());
    expect(Object.keys(files).sort()).toEqual(Object.values(PACKET_FILES).sort());
    expect(files[PACKET_FILES.brief]).toBe('changes[1]: CH1 adds a retry\n');
    expect(files[PACKET_FILES.description]).toBe('Adds a retry with backoff.\n');
    const ctx = JSON.parse(files[PACKET_FILES.context]!);
    expect(ctx.genreOptions.map((g: { id: string }) => g.id)).toEqual(['kaiju']);
    expect(ctx.recentComics).toEqual([]);
    const text = files[PACKET_FILES.instructions]!;
    expect(text).toContain('/skills/tracetoon-draw-cartoon/SKILL.md');
    expect(text).toContain('/run/comic.json');
    expect(text).toContain('/run/comic-design.json');
    expect(text).toContain('tracetoon comic check --run r1');
    // The diff is referenced, never inlined.
    expect(text).toContain('/run/changes.patch');
    expect(text).toContain('never read it whole');
  });

  test('the same inputs give the same packet (comicbench relies on it)', () => {
    expect(comicPacketFiles(input())).toEqual(comicPacketFiles(input()));
  });

  test('prefers the draw-cartoon skill beside the main skill, else the comic references', () => {
    const root = tempDir('tracetoon-skills-');
    const main = join(root, 'tracetoon');
    mkdirSync(join(main, 'references'), { recursive: true });
    for (const f of ['comic-guide.md', 'comic-direction.md', 'genres.md', 'styles.md'])
      writeFileSync(join(main, 'references', f), '#');
    expect(comicSkillFiles(main)).toEqual([
      join(main, 'references', 'comic-guide.md'),
      join(main, 'references', 'comic-direction.md'),
      join(main, 'references', 'genres.md'),
      join(main, 'references', 'styles.md'),
    ]);
    mkdirSync(join(root, DRAW_CARTOON_SKILL));
    writeFileSync(join(root, DRAW_CARTOON_SKILL, 'SKILL.md'), '#');
    expect(comicSkillFiles(main)).toEqual([join(root, DRAW_CARTOON_SKILL, 'SKILL.md')]);
  });

  test('the draw-cartoon skill: valid frontmatter, fresh reference copies, no commands or URLs', () => {
    expect(staleDrawCartoon()).toEqual([]);
    const skill = readFileSync(join(DRAW_CARTOON_DIR, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill)![1]!;
    expect(fm).toMatch(/^name: tracetoon-draw-cartoon$/m);
    const description = /^description: "(.*)"$/m.exec(fm)![1]!;
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(skill.length).toBeLessThan(8 * 1024);
    // Instructions only: the packet carries the commands, so plugin packages need no rewrite.
    expect(skill).not.toMatch(/https?:\/\//);
    expect(skill).not.toMatch(/`tracetoon [a-z]/);
    for (const m of skill.matchAll(/\]\((references\/[^)]+)\)/g))
      expect(readFileSync(join(DRAW_CARTOON_DIR, m[1]!), 'utf8').length).toBeGreaterThan(0);
  });

  test('the comic guide names every expression comic check accepts', () => {
    // Comic authors guessed moods like "sly" until the guide listed them.
    const guide = readFileSync(join(DRAW_CARTOON_DIR, 'references', 'comic-guide.md'), 'utf8');
    for (const e of EXPRESSIONS) expect(guide).toContain(`\`${e}\``);
  });
});

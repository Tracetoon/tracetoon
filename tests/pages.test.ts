/** Comic pages: free formats, made-up characters, any art style, model lettering. */
import { describe, expect, test } from 'bun:test';
import { composePage, imageSize, pageWithFooter } from '../src/comic/compose.ts';
import { artPrompt, pagePrompt } from '../src/comic/providers.ts';
import { checkScript, errors, pageText, transcript } from '../src/comic/script.ts';
import { freshStyles, STYLES, styleById } from '../src/comic/styles.ts';
import { pageScript } from './pageScript.ts';

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('page scripts', () => {
  test('a page in a free format, with its own characters, passes', () => {
    expect(errors(checkScript(pageScript()))).toEqual([]);
  });

  test('the old fixed 4-panel format (v1) gets a clear error', () => {
    const p = errors(checkScript({ ...pageScript(), v: 1 }));
    expect(p[0]!.problem).toContain('was removed');
  });

  test("characters must be the comic's own, each described once", () => {
    const stranger = pageScript();
    stranger.panels[0]!.characters = [{ name: 'Kit', position: 'left' }];
    stranger.panels[0]!.dialogue = [{ speaker: 'Kit', text: 'Hi!' }];
    const p = errors(checkScript(stranger));
    expect(p.map((x) => x.where)).toEqual([
      'panels[0].characters[0].name',
      'panels[0].dialogue[0].speaker',
    ]);
    expect(p[0]!.problem).toContain("isn't in this comic's characters (dev, link)");
    const vague = pageScript({ characters: [{ name: 'Dev', description: '' }] });
    expect(errors(checkScript(vague)).map((x) => x.where)).toContain(
      'characters[0].description',
    );
    // No characters at all is fine: scenes and captions only.
    const none = pageScript({ characters: [] });
    none.panels.forEach((p) => {
      p.characters = [];
      p.dialogue = p.dialogue.filter((d) => d.speaker === 'caption');
    });
    expect(errors(checkScript(none))).toEqual([]);
  });

  test('panel count, headline and word limits', () => {
    const many = pageScript({
      format: 'custom',
      panels: Array.from({ length: 10 }, () => pageScript().panels[0]!),
    });
    expect(errors(checkScript(many)).map((p) => p.where)).toContain('panels');
    const loud = pageScript({ headline: 'one two three four five six seven' });
    expect(errors(checkScript(loud)).map((p) => p.where)).toContain('headline');
    const wordy = pageScript();
    wordy.panels[0]!.dialogue = Array.from({ length: 4 }, () => ({
      speaker: 'caption',
      text: 'words that go on and on and on and on and on and on and on still',
    }));
    for (let i = 0; i < 3; i++) wordy.panels.push(structuredClone(wordy.panels[0]!));
    expect(
      errors(checkScript(wordy)).some((p) => p.problem.includes('quick to read')),
    ).toBe(true);
    expect(
      errors(checkScript(pageScript({ format: 'custom', layout: '' })))[0]!.where,
    ).toBe('layout');
  });

  test('any art style: a preset by id, or free text; reuse is fine', () => {
    const own = pageScript({ style: '1970s Saturday-morning cel animation' });
    expect(errors(checkScript(own))).toEqual([]);
    expect(pagePrompt(own)).toContain('Art style: 1970s Saturday-morning cel animation');
    expect(pagePrompt(pageScript())).toContain(styleById('sunday-strip')!.prompt);
    expect(errors(checkScript(pageScript({ style: '' })))[0]!.where).toBe('style');
    const p = checkScript(pageScript(), { recentStyles: ['Sunday-Strip'] });
    expect(p.find((x) => x.where === 'style')).toBeUndefined();
    expect(errors(checkScript(pageScript(), { pinnedStyle: 'noir' }))[0]!.where).toBe(
      'style',
    );
    expect(freshStyles(['noir'], 'sunday-strip').at(-1)!.id).toBe('noir');
    expect(freshStyles([], 'sunday-strip').some((s) => s.id === 'sunday-strip')).toBe(
      false,
    );
  });

  test('the page prompt carries every word, the characters, the layout and the style', () => {
    const s = pageScript();
    const prompt = pagePrompt(s);
    for (const t of pageText(s)) expect(prompt).toContain(`"${t}"`);
    expect(prompt).toContain('BEFORE on the left, AFTER on the right');
    expect(prompt).toContain('wide landscape 16:9');
    expect(prompt).toContain('Dev: a tired developer in a hoodie, round glasses');
    expect(prompt).not.toMatch(/\bKit\b|fox|character reference/);
    expect(artPrompt(s.panels[1]!, 1, s)).toContain(
      'Link: a cheerful glowing blue hyperlink with tiny arms (right',
    );
    expect(transcript(s)).toContain('**Dev:** Where is this file?');
  });

  test('a whole page gets a footer bar that says only "made with Tracetoon"', () => {
    expect(imageSize(PNG)).toEqual({ w: 1, h: 1 });
    const svg = pageWithFooter({ mime: 'image/png', data: PNG });
    expect(svg.match(/<text[^>]*>([^<]*)<\/text>/g)).toEqual([
      expect.stringContaining('>made with Tracetoon<'),
    ]);
  });

  test('overlay lettering lays out any number of panels', () => {
    for (const n of [1, 2, 3, 5, 6]) {
      const s = pageScript({
        format: 'custom',
        layout: 'grid',
        panels: Array.from({ length: n }, () => pageScript().panels[0]!),
      });
      const svg = composePage(s, []);
      expect(svg.match(/<clipPath/g)?.length).toBe(n);
      expect(svg).toContain('CLICK HERE, HUMAN');
      expect(svg).toContain('made with Tracetoon');
    }
  });
});

describe('comic look and user requests', () => {
  test('pages are asked to look like drawn comics unless the style wants another medium', () => {
    expect(pagePrompt(pageScript())).toContain('It must look like a drawn comic');
    expect(
      pagePrompt(pageScript({ style: 'stop-motion claymation diorama' })),
    ).not.toContain('It must look like a drawn comic');
    // A user's request for another medium lifts the guard too.
    expect(
      pagePrompt(pageScript({ request: 'make it a claymation diorama' })),
    ).not.toContain('It must look like a drawn comic');
    // Old presets still expand to their tested prompt and keep their palettes.
    expect(pagePrompt(pageScript({ style: 'claymation' }))).toContain('plasticine');
    expect(styleById('risograph')!.palettes).toEqual(['duotone']);
    expect(pagePrompt(pageScript({ style: 'risograph', palette: undefined }))).toContain(
      'two-color print',
    );
    for (const s of STYLES) expect(s.family).not.toBe('custom');
  });

  test('an explicit user request is sent and lifts the archetypes-only rule', () => {
    const plain = pagePrompt(pageScript());
    expect(plain).toContain('genre parody of familiar character types and settings is welcome');
    expect(plain).toContain('never reproduce a specific existing film, TV, cartoon or game character');
    const asked = pageScript({ request: 'stormtroopers arguing about tabs' });
    expect(errors(checkScript(asked))).toEqual([]);
    const prompt = pagePrompt(asked);
    expect(prompt).toContain(
      'The user asked for this; honor it exactly: stormtroopers arguing about tabs.',
    );
    expect(prompt).not.toContain('never reproduce a specific existing');
    expect(prompt).toContain('no identifiable real-person or celebrity likenesses');
    expect(artPrompt(asked.panels[0]!, 0, asked)).not.toContain(
      'never reproduce a specific existing',
    );
    expect(
      errors(checkScript(pageScript({ request: '  ' }))).map((p) => p.where),
    ).toContain('request');
  });
});

describe('skill docs stay in sync', () => {
  test('styles.md matches the style ideas', async () => {
    const { readFileSync } = await import('node:fs');
    const { STYLES_MD } = await import('../scripts/gen-styles.ts');
    const doc = readFileSync(
      new URL('../plugin/skills/tracetoon/references/styles.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(doc).toBe(STYLES_MD);
  });

  test('genres.md matches the genre catalog', async () => {
    const { readFileSync } = await import('node:fs');
    const { GENRES_MD } = await import('../scripts/gen-genres.ts');
    const doc = readFileSync(
      new URL('../plugin/skills/tracetoon/references/genres.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(doc).toBe(GENRES_MD);
  });

  test("the comic guide's example passes comic check", async () => {
    const { readFileSync } = await import('node:fs');
    const guide = readFileSync(
      new URL('../plugin/skills/tracetoon/references/comic-guide.md', import.meta.url),
      'utf8',
    );
    const json = /```json\n(\{\n  "v": 2[\s\S]*?\n\})\n```/.exec(
      guide.replace(/\r\n/g, '\n'),
    )![1]!;
    expect(checkScript(JSON.parse(json))).toEqual([]);
  });

  test('the share caption fits a post', async () => {
    const { shareCaption } = await import('../src/commands/publish.ts');
    const long = pageScript({ synopsis: 'word '.repeat(200) });
    const c = shareCaption(long, 'T', 'https://github.com/acme/widgets/pull/42');
    expect(c.length).toBeLessThanOrEqual(280);
    expect(c.startsWith('CLICK HERE, HUMAN — ')).toBe(true);
    expect(c.endsWith('https://github.com/acme/widgets/pull/42 #tracetoon')).toBe(true);
  });
});

describe('agent CLI wrapper prompt', () => {
  test('never forbids the lettering a page prompt asks for', async () => {
    const { agentBatchPrompt } = await import('../src/comic/providers.ts');
    const wrapped = agentBatchPrompt(
      [{ prompt: pagePrompt(pageScript()), refs: [] }],
      [],
    );
    expect(wrapped).not.toMatch(/do not add text|no text/i);
    expect(wrapped).toContain('"CLICK HERE, HUMAN"');
  });
});

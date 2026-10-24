import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown';

describe('safeHref', () => {
  it.each([
    ['https://profile.intra.42.fr/events/1', 'https://profile.intra.42.fr/events/1'],
    ['http://example.org', 'http://example.org/'],
    ['mailto:bde@example.org', 'mailto:bde@example.org'],
  ])('keeps %s', (input, href) => expect(safeHref(input)).toBe(href));

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:x',
    '//evil.example',
    '/relative',
    'file:///etc/passwd',
    '',
  ])('refuses %j', (input) => expect(safeHref(input)).toBeNull());
});

describe('parseInline', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** _c_ `d` [e](https://x.org)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.org/', children: [{ type: 'text', text: 'e' }] },
    ]);
  });

  it('leaves an emphasis that never closes as typed, and a snake_case word alone', () => {
    expect(parseInline('**oups')).toEqual([{ type: 'text', text: '**oups' }]);
    expect(parseInline('un_mot_en_snake_case')).toEqual([
      { type: 'text', text: 'un_mot_en_snake_case' },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });

  it('shows an image as its description and never as a picture', () => {
    expect(parseInline('![logo](https://evil.example/x.png)')).toEqual([
      { type: 'text', text: 'logo' },
    ]);
  });

  it('keeps a link with an address that runs as text', () => {
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[clic](javascript:alert(1))' },
    ]);
  });

  it('honours an escape', () => {
    expect(parseInline('\\*pas gras\\*')).toEqual([{ type: 'text', text: '*pas gras*' }]);
  });

  it('keeps a tag as the text it is', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('stops nesting at a depth, whatever it is given', () => {
    expect(() => parseInline('**__'.repeat(3000) + '*_x')).not.toThrow();
  });
});

describe('parseMarkdown', () => {
  it('reads the blocks of a description', () => {
    const blocks = parseMarkdown(
      '## Titre\n\nUne ligne\nune autre\n\n- a\n- b\n\n1. un\n2. deux\n\n> cité\n\n---\n\n```\ncode **brut**\n```',
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'rule',
      'code',
    ]);
    expect(blocks[1]).toMatchObject({ lines: [expect.any(Array), expect.any(Array)] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[6]).toEqual({ type: 'code', text: 'code **brut**' });
  });

  it('keeps the line breaks of a paragraph (what the description always showed)', () => {
    const [paragraph] = parseMarkdown('un\ndeux\ntrois');
    expect(paragraph).toMatchObject({ type: 'paragraph' });
    expect((paragraph as { lines: unknown[] }).lines).toHaveLength(3);
  });

  it('reads a closed heading and a text with nothing in it', () => {
    expect(parseMarkdown('# Titre #')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Titre' }] },
    ]);
    expect(parseMarkdown('   ')).toEqual([]);
  });

  it('survives a hostile text: nothing becomes HTML, nothing runs away', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '[x](javascript:alert(1))',
      '![x](https://evil.example/p.png)',
      '> '.repeat(500),
      '- '.repeat(5000),
      '`'.repeat(9999),
      '[a](' + '('.repeat(5000),
    ].join('\n');
    const start = Date.now();
    const blocks = parseMarkdown(hostile);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(JSON.stringify(blocks)).not.toMatch(/"href":"javascript/i);
  });
});

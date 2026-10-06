import { describe, expect, it } from 'vitest';
import { httpUrl, truncate } from './text';

describe('truncate', () => {
  it('leaves a text that fits, even exactly', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('', 3)).toBe('');
  });

  it('cuts to at most the limit, with an ellipsis', () => {
    const out = truncate('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(Array.from(out)).toHaveLength(5);
  });

  it('cuts at a word when little is lost by it', () => {
    expect(truncate('Venez nombreux à la soirée de rentrée', 30)).toBe(
      'Venez nombreux à la soirée…',
    );
  });

  it('cuts in the middle of a long word rather than lose most of the text', () => {
    expect(truncate('ab cdefghijklmnop', 8)).toBe('ab cdef…');
  });

  it('never splits a character made of two code units', () => {
    const out = truncate('😀😀😀😀😀😀', 4);
    expect(out).toBe('😀😀😀…');
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('counts characters, not UTF-16 units, so an emoji does not use two', () => {
    expect(truncate('😀😀😀', 3)).toBe('😀😀😀');
  });

  it('copes with a limit of zero or one', () => {
    expect(truncate('abc', 1)).toBe('…');
    expect(truncate('abc', 0)).toBe('…');
  });
});

describe('httpUrl', () => {
  it('accepts http and https addresses, normalized', () => {
    expect(httpUrl('https://bde.example/fr/events/1')).toBe('https://bde.example/fr/events/1');
    expect(httpUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it.each([
    undefined,
    null,
    '',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'ftp://bde.example/x',
  ])('refuses %j', (value) => {
    expect(httpUrl(value)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { colorToInt, MEMBER_COLORS, NEUTRAL_COLOR, normalizeHex } from './colors';

describe('colorToInt', () => {
  it('turns a six-digit hex colour into the number Discord wants', () => {
    expect(colorToInt('#0f766e')).toBe(0x0f766e);
    expect(colorToInt('#FFFFFF')).toBe(0xffffff);
    expect(colorToInt('#000000')).toBe(0);
  });

  it('expands the three-digit form', () => {
    expect(colorToInt('#abc')).toBe(0xaabbcc);
  });

  it.each([null, undefined, '', 'red', '#12', '#12345', '#1234567', '0f766e', '#ggg'])(
    'falls back to the neutral grey for %j',
    (value) => {
      expect(colorToInt(value)).toBe(NEUTRAL_COLOR);
    },
  );

  it('gives each kind of member notification its own colour', () => {
    const colors = Object.values(MEMBER_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).not.toContain(NEUTRAL_COLOR);
  });
});

describe('normalizeHex', () => {
  it('writes a hex colour as six lower-case digits', () => {
    expect(normalizeHex('#0F766E')).toBe('#0f766e');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('  #123456 ')).toBe('#123456');
  });

  it.each([
    '',
    null,
    undefined,
    'red',
    '#12',
    '#12345',
    '#1234567',
    '0f766e',
    'red;background:url(x)',
    '#fff"onload="x',
  ])('falls back to the neutral grey for %j, so a colour never carries markup', (value) => {
    expect(normalizeHex(value)).toBe('#6b7280');
  });
});

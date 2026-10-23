import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colorToInt, EMAIL_TOKENS, MEMBER_COLORS, NEUTRAL_COLOR, normalizeHex } from './colors';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The tokens of one theme of globals.css (`:root` is the light one), as a map of name to hex. */
function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const header = theme === 'light' ? ':root,\n.light {' : '.dark {';
  const start = css.indexOf(`\n${header}`);
  if (start < 0) throw new Error(`no ${theme} block in globals.css`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}

/** The middle of two hex colours, rounded up as 0xRR (what colors.ts writes). */
function middle(a: string, b: string): number {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return [0, 1, 2].reduce((n, i) => n * 256 + Math.round((channel(a, i) + channel(b, i)) / 2), 0);
}

describe('the colours of the cards and e-mails are those of the interface', () => {
  const light = tokens('light');
  const dark = tokens('dark');

  it('writes the grounds and inks of an e-mail as the neutral tokens of each theme', () => {
    expect(EMAIL_TOKENS.light).toEqual({
      page: light.bg,
      card: light.surface,
      ink: light.ink,
      muted: light.muted,
      line: light.line,
    });
    expect(EMAIL_TOKENS.dark).toEqual({
      page: dark.bg,
      card: dark.surface,
      ink: dark.ink,
      muted: dark.muted,
      line: dark.line,
    });
  });

  it('gives the member notifications the status tokens, halfway between their two themes', () => {
    expect(MEMBER_COLORS.pending).toBe(middle(light.warning!, dark.warning!));
    expect(MEMBER_COLORS.approved).toBe(middle(light.success!, dark.success!));
    expect(MEMBER_COLORS.removed).toBe(middle(light.danger!, dark.danger!));
  });

  it('gives the neutral grey the middle of the muted token of the two themes', () => {
    expect(NEUTRAL_COLOR).toBe(middle(light.muted!, dark.muted!));
  });
});

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
    expect(normalizeHex(value)).toBe('#7a818b');
  });
});

import { describe, expect, it } from 'vitest';
import { buildAccentStyle, deriveAccent, getContrastingTextColor } from './color';

describe('getContrastingTextColor', () => {
  it('picks black text on a light color', () => {
    expect(getContrastingTextColor('#ffffff')).toBe('#000000');
    expect(getContrastingTextColor('#ffd700')).toBe('#000000');
  });

  it('picks white text on a dark color', () => {
    expect(getContrastingTextColor('#000000')).toBe('#ffffff');
    expect(getContrastingTextColor('#0f172a')).toBe('#ffffff');
  });

  it('handles 3-digit shorthand hex', () => {
    expect(getContrastingTextColor('#fff')).toBe('#000000');
    expect(getContrastingTextColor('#000')).toBe('#ffffff');
  });
});

// WCAG 2.x, written here on its own (not the module's helpers) so that the guarantees are checked, not assumed.
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (over: Rgb, alpha: number, under: Rgb): Rgb =>
  over.map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha))) as Rgb;

const WORST = { light: '#E8E8E6', dark: '#26262A' } as const;
const ALPHA = { light: 0.13, dark: 0.22 } as const;

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[channel(0), channel(8), channel(4)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('deriveAccent', () => {
  it.each([
    ['#2F5BEA', 'light', { fill: '#2F5BEA', on: '#FFFFFF' }],
    ['#2F5BEA', 'dark', { fill: '#2F5BEA', on: '#FFFFFF' }],
    // a medium orange or green takes dark text rather than being changed
    ['#E4572E', 'light', { fill: '#E4572E', on: '#111111' }],
    ['#1E9E6A', 'light', { fill: '#1E9E6A', on: '#111111' }],
    ['#F0B429', 'light', { fill: '#F0B429', on: '#111111' }],
    ['#F0B429', 'dark', { fill: '#F0B429', on: '#111111' }],
    // the teal of the existing platforms keeps white text
    ['#0f766e', 'light', { fill: '#0F766E', on: '#FFFFFF' }],
  ] as const)('keeps %s as the fill in the %s theme, with %s', (hex, theme, wanted) => {
    const tokens = deriveAccent(hex, theme);
    expect(tokens.fill).toBe(wanted.fill);
    expect(tokens.on).toBe(wanted.on);
    expect(tokens.adjusted).toBe(false);
  });

  it('darkens a colour that neither white nor dark text can carry, and says so', () => {
    // white 4.4:1 and near black 4.5- on this one: a grey of luminance 0.19: neither reaches 4.5
    const hex = '#797979';
    expect(ratio(rgb('#FFFFFF'), rgb(hex))).toBeLessThan(4.5);
    expect(ratio(rgb('#111111'), rgb(hex))).toBeLessThan(4.5);
    const tokens = deriveAccent(hex, 'light');
    expect(tokens.adjusted).toBe(true);
    expect(tokens.on).toBe('#FFFFFF');
    expect(tokens.fill).not.toBe(hex);
    expect(ratio(rgb('#FFFFFF'), rgb(tokens.fill))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the guarantees of the specification for any colour, in both themes', () => {
    // a fixed spread of colours (hue, lightness and saturation walked in steps), not a random draw: a failure replays
    for (let hue = 0; hue < 360; hue += 15) {
      for (const lightness of [8, 20, 35, 50, 65, 80, 92]) {
        for (const saturation of [0, 45, 100]) {
          const hex = hslToHex(hue, saturation, lightness);
          for (const theme of ['light', 'dark'] as const) {
            const tokens = deriveAccent(hex, theme);
            const onFill = ratio(rgb(tokens.on), rgb(tokens.fill));
            // accent-on on accent-fill: 4.5:1
            expect(onFill, `${hex} ${theme} on/fill`).toBeGreaterThanOrEqual(4.5);
            // accent-ink on its own tint over the worst surface: 4.6:1
            const soft = blend(rgb(hex), ALPHA[theme], rgb(WORST[theme]));
            expect(ratio(rgb(tokens.ink), soft), `${hex} ${theme} ink/soft`).toBeGreaterThanOrEqual(
              4.6,
            );
            // the states only add contrast
            expect(
              ratio(rgb(tokens.on), rgb(tokens.fillHover)),
              `${hex} ${theme} hover`,
            ).toBeGreaterThanOrEqual(onFill - 0.05);
          }
        }
      }
    }
  });

  it('draws a hairline round a fill that is close to the page (spec 3.3)', () => {
    expect(deriveAccent('#E6E8EC', 'light').edge).toBe(true); // a very light grey on the light page
    expect(deriveAccent('#10131A', 'dark').edge).toBe(true); // a navy on the dark page
    expect(deriveAccent('#2F5BEA', 'light').edge).toBe(false);
    expect(deriveAccent('#2F5BEA', 'dark').edge).toBe(false);
  });

  it('darkens the states of a fill with white text and lightens those of a fill with dark text', () => {
    const white = deriveAccent('#2F5BEA', 'light');
    expect(lum(rgb(white.fillHover))).toBeLessThan(lum(rgb(white.fill)));
    expect(lum(rgb(white.fillPressed))).toBeLessThan(lum(rgb(white.fillHover)));
    const dark = deriveAccent('#F0B429', 'light');
    expect(lum(rgb(dark.fillHover))).toBeGreaterThan(lum(rgb(dark.fill)));
    expect(lum(rgb(dark.fillPressed))).toBeGreaterThan(lum(rgb(dark.fillHover)));
  });

  it('tints with the colour of the BDE itself, a little more under the pointer', () => {
    expect(deriveAccent('#2F5BEA', 'light').soft).toBe('rgba(47, 91, 234, 0.13)');
    expect(deriveAccent('#2F5BEA', 'light').softHover).toBe('rgba(47, 91, 234, 0.19)');
    expect(deriveAccent('#2F5BEA', 'dark').soft).toBe('rgba(47, 91, 234, 0.22)');
    expect(deriveAccent('#2F5BEA', 'dark').softHover).toBe('rgba(47, 91, 234, 0.28)');
  });

  it('veils the accent card in white or in near black, whichever its text is', () => {
    expect(deriveAccent('#2F5BEA', 'light').onSoft).toBe('rgba(255, 255, 255, 0.22)');
    expect(deriveAccent('#F0B429', 'light').onSoft).toBe('rgba(17, 17, 17, 0.12)');
  });

  it('is the same colour in both themes except for what must change with the surface', () => {
    const light = deriveAccent('#2F5BEA', 'light');
    const dark = deriveAccent('#2F5BEA', 'dark');
    expect(dark.fill).toBe(light.fill);
    expect(dark.ink).not.toBe(light.ink); // pushed toward black on light, toward white on dark
    expect(lum(rgb(dark.ink))).toBeGreaterThan(lum(rgb(light.ink)));
  });
});

describe('buildAccentStyle', () => {
  it('writes the tokens of both themes, for globals.css to pick from', () => {
    const style = buildAccentStyle('#0f766e');
    expect(style['--accent-fill-l']).toBe('#0F766E');
    expect(style['--accent-fill-d']).toBe('#0F766E');
    expect(style['--accent-on-l']).toBe('#FFFFFF');
    expect(style['--accent-ink-l']).toBe(deriveAccent('#0f766e', 'light').ink);
    expect(style['--accent-ink-d']).toBe(deriveAccent('#0f766e', 'dark').ink);
    expect(style['--accent-soft-d']).toBe('rgba(15, 118, 110, 0.22)');
  });

  it('draws no hairline unless the accent is close to the page', () => {
    expect(buildAccentStyle('#2F5BEA')['--accent-edge-l']).toBe('0 0 0 0 transparent');
    expect(buildAccentStyle('#E6E8EC')['--accent-edge-l']).toBe('inset 0 0 0 1px var(--line)');
  });

  it('writes the same set of properties for every colour', () => {
    expect(Object.keys(buildAccentStyle('#E4572E')).sort()).toEqual(
      Object.keys(buildAccentStyle('#0f766e')).sort(),
    );
  });
});

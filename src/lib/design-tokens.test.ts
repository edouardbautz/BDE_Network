// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contrast table of docs/design.md ("Contrast (WCAG AA)"), as a test on the real tokens of `globals.css`: each pair is
 * converted from OKLCH to sRGB, blended where the interface blends (a button tinted with 10 % of its colour), and its WCAG
 * contrast ratio must reach 4.5:1 (normal text) in the light and the dark theme. Changing a token that breaks a pair fails here
 * instead of on a page. A new pair of text and surface goes in the list, with the table of the design document.
 */

type Rgb = [number, number, number];

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The tokens of one block (`:root { … }` or `.dark { … }`), as `name → oklch triplet`. */
function tokensOf(selector: string): Record<string, [number, number, number]> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const tokens: Record<string, [number, number, number]> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
    tokens[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }
  return tokens;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinear([lightness, chroma, hue]: [number, number, number]): Rgb {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return channels.map((channel) => Math.min(1, Math.max(0, channel))) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
/** `colour` at `alpha` over `surface`, blended on the sRGB values like the browser does. */
const over = (colour: Rgb, surface: Rgb, alpha: number): Rgb =>
  colour.map((channel, index) =>
    toLinear(toGamma(channel) * alpha + toGamma(surface[index]!) * (1 - alpha)),
  ) as Rgb;

/** A pair is `[text token, surface token, share of the text colour blended into the surface]`. */
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', 0],
  ['foreground', 'card', 0],
  ['muted-foreground', 'background', 0],
  ['muted-foreground', 'card', 0],
  ['muted-foreground', 'muted', 0],
  ['primary-foreground', 'primary', 0],
  ['destructive', 'background', 0],
  ['destructive', 'card', 0],
  ['destructive', 'muted', 0],
  // The destructive button is the colour on a tint of itself (`bg-destructive/10`).
  ['destructive', 'background', 0.1],
  ['destructive', 'card', 0.1],
  ['destructive', 'muted', 0.1],
];

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)(
  'the %s theme meets WCAG AA (4.5:1) for its text and surface pairs',
  (_theme, selector) => {
    const tokens = tokensOf(selector);

    it('defines every token of the pairs', () => {
      for (const [text, surface] of PAIRS) {
        expect(tokens[text], text).toBeDefined();
        expect(tokens[surface], surface).toBeDefined();
      }
    });

    it.each(PAIRS)('%s on %s (%s of it blended in)', (text, surface, share) => {
      const foreground = oklchToLinear(tokens[text]!);
      const base = oklchToLinear(tokens[surface]!);
      const ratio = contrast(foreground, share > 0 ? over(foreground, base, share) : base);
      expect(
        ratio,
        `${text} on ${surface}${share ? ` tinted ${share * 100} %` : ''}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  },
);

describe('the page layout', () => {
  it('keeps the place of the scrollbar, so that a page that grows does not move sideways', () => {
    // A page is short while its skeleton shows and long once it is drawn; a classic scrollbar (Windows, Linux) that appears then
    // moves the whole content by half its width. Measured by Lighthouse on the members page: a layout shift of 0.78.
    const base = /@layer base\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    const html = /html\s*\{([^}]*)\}/.exec(base)?.[1] ?? '';
    expect(html).toMatch(/scrollbar-gutter:\s*stable/);
  });
});

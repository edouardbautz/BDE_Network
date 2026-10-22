// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveAccent } from './color';

/**
 * The contrast table of docs/design.md ("Contrast (WCAG AA)"), as a test on the real tokens of `globals.css`: each pair is read
 * from the light and the dark theme, blended where the interface blends (a soft background is a colour at some opacity over a
 * surface), and its WCAG contrast ratio must reach what the specification claims. Changing a token that breaks a pair fails here
 * instead of on a page. A new pair of text and surface goes in the list, with the table of the design document.
 */

type Rgb = [number, number, number];

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The text of one block of tokens (`:root { … }` or `.dark { … }`), up to its closing brace. */
function blockOf(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  return css.slice(start, css.indexOf('\n}', start));
}

/** A token of a theme as a colour: `#rrggbb`, or `rgba(r, g, b, a)` over the surface the caller says. */
interface Colour {
  rgb: Rgb;
  alpha: number;
}

function tokenOf(block: string, name: string): Colour {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  if (!value) throw new Error(`--${name} is not defined in the block`);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba)
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  throw new Error(`--${name}: ${value} is not a colour this test reads`);
}

const toLinear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
/** `colour` at its own opacity over `surface`, blended on the sRGB values like the browser does. */
const over = ({ rgb, alpha }: Colour, surface: Rgb): Rgb =>
  rgb.map((channel, index) => Math.round(channel * alpha + surface[index]! * (1 - alpha))) as Rgb;

/** A pair is `[text, surface, minimum]`: the text token over the surface token (blended when the surface is translucent). */
const PAIRS: [string, string, number][] = [
  // 2.1: the neutrals
  ['ink', 'surface', 4.5],
  ['ink', 'surface-2', 4.5],
  ['ink', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['muted', 'bg', 4.5],
  // 2.2: the semantic text on its own soft background (and on the surface it is mostly met on)
  ['danger', 'danger-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['on-danger', 'danger-fill', 4.5],
];

/** The soft backgrounds are translucent in the dark theme: they are judged over the surface they sit on. */
const SOFT = new Set(['danger-soft', 'success-soft', 'warning-soft']);

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)('the %s theme meets WCAG AA for its text and surface pairs', (_theme, selector) => {
  const block = blockOf(selector);

  it.each(PAIRS)('%s on %s reaches %s:1', (text, surface, minimum) => {
    const base = tokenOf(block, SOFT.has(surface) ? 'surface' : surface);
    const surfaceRgb = SOFT.has(surface) ? over(tokenOf(block, surface), base.rgb) : base.rgb;
    expect(contrast(tokenOf(block, text).rgb, surfaceRgb)).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps the numbers the specification gives for the neutrals', () => {
    const ratio = (a: string, b: string) => contrast(tokenOf(block, a).rgb, tokenOf(block, b).rgb);
    const wanted = _theme === 'light' ? { ink: 18.1, muted: 6.3 } : { ink: 14.9, muted: 6.6 };
    expect(ratio('ink', 'surface')).toBeCloseTo(wanted.ink, 0);
    expect(ratio('muted', 'surface')).toBeCloseTo(wanted.muted, 0);
  });
});

describe("the accent that applies before the layout has written the BDE's own", () => {
  // globals.css falls back on the default accent #2F5BEA when the layout has not written the tokens (a test, the startup page):
  // those fallbacks are the algorithm's result, not a second opinion.
  it.each([
    ['light', ':root', 'l'],
    ['dark', '.dark', 'd'],
  ] as const)(
    'is what deriveAccent gives for #2F5BEA in the %s theme',
    (theme, selector, suffix) => {
      const block = blockOf(selector);
      const fallback = (name: string) =>
        new RegExp(`--accent-${name}:\\s*var\\(--accent-${name}-${suffix},\\s*([^;]+);`)
          .exec(block)?.[1]
          ?.trim()
          .replace(/\)$/, '')
          .toLowerCase();
      const derived = deriveAccent('#2F5BEA', theme);
      const normal = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
      expect(fallback('fill')).toBe(derived.fill.toLowerCase());
      expect(fallback('fill-hover')).toBe(derived.fillHover.toLowerCase());
      expect(fallback('fill-pressed')).toBe(derived.fillPressed.toLowerCase());
      expect(fallback('on')).toBe(derived.on.toLowerCase());
      expect(fallback('ink')).toBe(derived.ink.toLowerCase());
      expect(normal(fallback('soft') ?? '')).toBe(normal(derived.soft));
      expect(normal(fallback('soft-hover') ?? '')).toBe(normal(derived.softHover));
      expect(normal(fallback('on-soft') ?? '')).toBe(normal(derived.onSoft));
    },
  );
});

describe('the tokens of the specification', () => {
  it.each([
    ['--radius-xs', '8px'],
    ['--radius-sm', '12px'],
    ['--radius-md', '14px'],
    ['--radius-lg', '16px'],
    ['--radius-xl', '20px'],
    ['--radius-2xl', '24px'],
    ['--radius-3xl', '26px'],
    ['--radius-dialog', '28px'],
    ['--radius-pill', '999px'],
  ])('%s is %s', (name, value) => {
    expect(new RegExp(`${name}:\\s*${value};`).test(css)).toBe(true);
  });

  it.each([
    ['--dur-instant', '80ms'],
    ['--dur-fast', '140ms'],
    ['--dur-base', '200ms'],
    ['--dur-slow', '280ms'],
    ['--ease-standard', 'cubic-bezier(0.2, 0, 0, 1)'],
    ['--ease-exit', 'cubic-bezier(0.4, 0, 1, 1)'],
  ])('%s is %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it('has no shadow in the dark theme but a hairline, and no gradient anywhere', () => {
    const dark = blockOf('.dark');
    for (const name of ['shadow-1', 'shadow-2', 'shadow-3']) {
      expect(new RegExp(`--${name}:\\s*0 0 0 1px rgba\\(255, 255, 255,`).test(dark)).toBe(true);
    }
    expect(css).not.toMatch(/gradient\(/);
  });
});

describe('the page layout', () => {
  it('keeps the place of the scrollbar, so that a page that grows does not move sideways', () => {
    // A page is short while its skeleton shows and long once it is drawn; a classic scrollbar (Windows, Linux) that appears then
    // moves the whole content by half its width. Measured by Lighthouse on the members page: a layout shift of 0.78.
    const base = /@layer base\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    const html = /html\s*\{([^}]*)\}/.exec(base)?.[1] ?? '';
    expect(html).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it('keeps one focus ring for every element, in the ink version of the accent', () => {
    const base = /@layer base\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent-ink\)/);
  });
});

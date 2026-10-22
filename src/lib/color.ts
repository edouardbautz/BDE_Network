function hexToRgb(hex: string): [number, number, number] {
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return [r, g, b];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Picks black or white text for readable contrast against the given hex color. */
export function getContrastingTextColor(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b) > 0.179 ? '#000000' : '#ffffff';
}

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const NEAR_BLACK: Rgb = [17, 17, 17];

const contrast = (a: Rgb, b: Rgb): number => {
  const [high, low] = [relativeLuminance(...a), relativeLuminance(...b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((channel, index) => Math.round(channel * (1 - t) + b[index]! * t)) as Rgb;

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The page background of each theme (`--bg` of globals.css): what the accent is compared with to see if it stands out. */
const BACKGROUND = { light: '#ECEEF1', dark: '#0E1012' } as const;

/** The darkest surface a tinted accent can sit on, per theme: the worst case for the text colour. */
const WORST_SURFACE = { light: '#E8E8E6', dark: '#26262A' } as const;

export interface AccentTokens {
  /** Solid background: primary button, accent card, logo, today, Create button. */
  fill: string;
  /** `fill` under the pointer, and pressed (the veil of the specification, worked out so that the contrast only goes up). */
  fillHover: string;
  fillPressed: string;
  /** Text and icons on `fill`: white or near black. */
  on: '#FFFFFF' | '#111111';
  /** The accent as text or icon on a surface (links, active icon, focus ring). */
  ink: string;
  /** Translucent tinted background (active entry, icon tile, event chip), and the same under the pointer. */
  soft: string;
  softHover: string;
  /** A veil on `fill`, always in the direction that raises the contrast of `on` (darker under white text, lighter under dark text): the badge of the accent card. */
  onSoft: string;
  /** The fill is too close to the page background: the surfaces filled with it get a hairline. */
  edge: boolean;
  /** The colour had to be darkened to carry white text: the settings page says so. */
  adjusted: boolean;
}

/**
 * The five tokens of the accent (and their states) for one theme, from the colour a BDE chose (docs/design.md, "Accent").
 * The colour is kept as it is whenever white or near-black text passes 4.5:1 on it; otherwise it is darkened until
 * white does. `ink` is pushed toward black (light) or white (dark) until it reads 4.6:1 even on its own tint.
 */
export function deriveAccent(hex: string, theme: 'light' | 'dark'): AccentTokens {
  const dark = theme === 'dark';
  const c = hexToRgb(hex);
  const alpha = dark ? 0.22 : 0.13;
  const softOnWorst = mix(hexToRgb(WORST_SURFACE[theme]), c, alpha);

  const toward: Rgb = dark ? WHITE : [0, 0, 0];
  let ink = c;
  for (let step = 0; step <= 50; step += 1) {
    ink = mix(c, toward, step / 50);
    if (contrast(ink, softOnWorst) >= 4.6) break;
  }

  let fill = c;
  let on: AccentTokens['on'];
  let adjusted = false;
  if (contrast(WHITE, c) >= 4.5) on = '#FFFFFF';
  else if (contrast(NEAR_BLACK, c) >= 4.5) on = '#111111';
  else {
    let step = 0;
    while (step < 50 && contrast(WHITE, mix(c, [0, 0, 0], step / 50)) < 4.5) step += 1;
    fill = mix(c, [0, 0, 0], step / 50);
    on = '#FFFFFF';
    adjusted = true;
  }

  // The veils of the specification: black at 8 % / 14 % over a fill with white text, white at 16 % / 26 % over one with dark text.
  const veil = (overWhiteText: number, overDarkText: number): Rgb =>
    on === '#FFFFFF' ? mix(fill, [0, 0, 0], overWhiteText) : mix(fill, WHITE, overDarkText);
  const rgba = (alphaValue: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alphaValue})`;

  return {
    fill: toHex(fill),
    fillHover: toHex(veil(0.08, 0.16)),
    fillPressed: toHex(veil(0.14, 0.26)),
    on,
    ink: toHex(ink),
    soft: rgba(alpha),
    softHover: rgba(Math.round((alpha + 0.06) * 100) / 100),
    onSoft: on === '#FFFFFF' ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.3)',
    edge: contrast(fill, hexToRgb(BACKGROUND[theme])) < 1.4,
    adjusted,
  };
}

/** The tokens of an accent as the custom properties `globals.css` reads, with a suffix for the theme. */
function propertiesOf(tokens: AccentTokens, suffix: 'l' | 'd'): Record<string, string> {
  return {
    [`--accent-fill-${suffix}`]: tokens.fill,
    [`--accent-fill-hover-${suffix}`]: tokens.fillHover,
    [`--accent-fill-pressed-${suffix}`]: tokens.fillPressed,
    [`--accent-on-${suffix}`]: tokens.on,
    [`--accent-ink-${suffix}`]: tokens.ink,
    [`--accent-soft-${suffix}`]: tokens.soft,
    [`--accent-soft-hover-${suffix}`]: tokens.softHover,
    [`--accent-on-soft-${suffix}`]: tokens.onSoft,
    [`--accent-edge-${suffix}`]: tokens.edge
      ? 'inset 0 0 0 1px var(--line)'
      : '0 0 0 0 transparent',
  };
}

/**
 * The accent of the BDE for both themes, as custom properties to put on the `<html>` element's `style`. Both themes are
 * written because the server cannot know the theme (it is the visitor's, and `system` follows their device): `globals.css`
 * picks the right set with `:root` and `.dark`, so there is no script and no flash. bde.config.yml's accentColor drives
 * the whole interface without touching the Tailwind build.
 */
export function buildAccentStyle(hex: string): Record<string, string> {
  return {
    ...propertiesOf(deriveAccent(hex, 'light'), 'l'),
    ...propertiesOf(deriveAccent(hex, 'dark'), 'd'),
  };
}

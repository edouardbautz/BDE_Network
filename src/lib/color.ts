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

/** CSS custom properties overriding the theme's accent-related tokens, meant
 * to be spread onto a `style` prop so bde.config.yml's accentColor drives the
 * whole interface without touching the Tailwind build. */
export function buildAccentStyle(hex: string): Record<string, string> {
  const foreground = getContrastingTextColor(hex);
  return {
    '--primary': hex,
    '--primary-foreground': foreground,
    '--ring': hex,
    '--sidebar-primary': hex,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-ring': hex,
  };
}

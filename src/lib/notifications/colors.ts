/** The colours of the cards and e-mails, the same on every channel. */

/** One colour per kind of member notification, mid-saturation so the bar reads on both of
 * Discord's themes (a pastel vanishes on the light one, a near-black one on the dark one). */
export const MEMBER_COLORS = {
  pending: 0xf59e0b, // amber: something waits for a decision
  approved: 0x10b981, // green
  removed: 0xef4444, // red
} as const;

/** Used for an event whose category has no colour (a category removed from the config). */
export const NEUTRAL_COLOR = 0x6b7280;

/** `#0f766e` or `#fff` → the number Discord wants; the neutral grey when it is not a hex colour. */
export function colorToInt(hex: string | null | undefined): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!match?.[1]) return NEUTRAL_COLOR;
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1];
  return parseInt(digits, 16);
}

/** `#0f766e` or `#abc` as `#0f766e`; the neutral grey for anything that is not a hex colour, so a
 * colour from the configuration can never inject anything into a style. */
/** `#0f766e` or `#abc` as `#0f766e`; the neutral grey for anything that is not a hex colour, so a
 * colour from the configuration can never inject anything into a style. */
export function normalizeHex(value: string | null | undefined): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value?.trim() ?? '');
  const neutral = `#${NEUTRAL_COLOR.toString(16).padStart(6, '0')}`;
  if (!match?.[1]) return neutral;
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1];
  return `#${digits.toLowerCase()}`;
}

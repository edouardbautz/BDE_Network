/** The colours of the cards and e-mails, the same on every channel, taken from the tokens of the interface (src/app/globals.css). */

/**
 * One colour per kind of member notification: the status tokens of the interface (`--warning`, `--success`, `--danger`), in the
 * tone halfway between their light and their dark value, so that a bar of 4 px reads on both themes of a chat (the light value
 * of each vanishes on the dark one, the dark value on the light one). `colors.test.ts` works them out from `globals.css`.
 */
export const MEMBER_COLORS = {
  pending: 0xc09036, // warning: something waits for a decision
  approved: 0x3aa06f, // success
  removed: 0xda5749, // danger
} as const;

/** Used for an event whose category has no colour (a category removed from the config): halfway between the two `--muted`. */
export const NEUTRAL_COLOR = 0x7a818b;

/**
 * The grounds and inks of an e-mail, in each theme: the neutral tokens of the interface (`--bg`, `--surface`, `--ink`, `--muted`,
 * `--line`). A mail client has no stylesheet of ours, so they are written out here; `colors.test.ts` holds them equal to
 * `globals.css`.
 */
export const EMAIL_TOKENS = {
  light: { page: '#eceef1', card: '#ffffff', ink: '#14161a', muted: '#5a606a', line: '#e6e8ec' },
  dark: { page: '#0e1012', card: '#181b1f', ink: '#eceef1', muted: '#9aa1ab', line: '#2a2f36' },
} as const;

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

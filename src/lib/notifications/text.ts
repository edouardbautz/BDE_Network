/** Small text helpers shared by every channel (Discord cards, e-mails). */

const ELLIPSIS = '…';

/** Cuts `text` to at most `max` characters, at a word when there is one near, never in the middle
 * of an emoji or any other character made of two code units, and marks the cut with "…". */
export function truncate(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;

  const kept = characters.slice(0, Math.max(0, max - 1));
  const lastSpace = kept.lastIndexOf(' ');
  // Back up to the last space only when little is lost by it.
  const cut = lastSpace > kept.length * 0.6 ? kept.slice(0, lastSpace) : kept;
  return cut.join('').trimEnd() + ELLIPSIS;
}

/** Only an http(s) address may leave as a link or a picture: anything else is dropped. */
export function httpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

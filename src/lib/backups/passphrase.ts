/**
 * The passphrase an owner chooses for a download: long enough to resist a guess, short enough not to be a way to waste the server's time
 * (a key is derived from it with 600,000 rounds). Pure, so the form checks it with the very rule the server applies.
 */
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 200;

export function passphraseProblem(passphrase: string): 'tooShort' | 'tooLong' | null {
  const length = [...passphrase].length;
  if (length < MIN_PASSPHRASE_LENGTH) return 'tooShort';
  if (length > MAX_PASSPHRASE_LENGTH) return 'tooLong';
  return null;
}

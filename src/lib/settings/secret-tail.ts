/**
 * The end of a secret, to tell one saved secret from another without showing it ("Configured · ends with …a1b2"). Only when the secret is
 * long enough that four characters are nothing (a webhook address, an application secret): a short one, or a password that a person
 * chose, gets no end at all, only "Configured". The browser never gets more than this.
 */
export function secretTail(secret: string | undefined | null): string | null {
  const value = (secret ?? '').trim();
  return value.length >= 16 ? value.slice(-4) : null;
}

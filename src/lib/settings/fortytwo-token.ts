import { realFetch, verifyCredentials, type FetchLike } from '@/lib/setup/fortytwo';
import { setting } from './runtime';

/**
 * A token of the platform's own 42 application, to list the campuses and check a login from the settings page
 * (the installer keeps its own, from the credentials it has just been given). Asked with the saved credentials,
 * kept for half an hour (a token lasts two), and forgotten when the credentials change.
 */

const TTL_MS = 30 * 60_000;

let cached: { token: string; fingerprint: string; until: number } | null = null;

const fingerprint = (id: string, secret: string): string =>
  `${id.length}:${id}:${secret.length}:${secret.slice(-4)}`;

/** Forgets the token (for the tests). */
export function forgetApplicationToken(): void {
  cached = null;
}

/** The token, or null when 42 cannot be asked or refuses the saved application. */
export async function applicationToken(
  fetchFn: FetchLike = realFetch,
  now: () => number = Date.now,
): Promise<string | null> {
  const id = setting('FORTYTWO_CLIENT_ID');
  const secret = setting('FORTYTWO_CLIENT_SECRET');
  if (!id || !secret) return null;

  const print = fingerprint(id, secret);
  if (cached && cached.fingerprint === print && cached.until > now()) return cached.token;

  const check = await verifyCredentials(fetchFn, id, secret);
  if (!check.ok) return null;
  cached = { token: check.token, fingerprint: print, until: now() + TTL_MS };
  return check.token;
}

import { fortyTwoApiBase } from '@/lib/fortytwo-api';
import { setting } from '@/lib/settings/runtime';
/**
 * Whether 42 still accepts this platform's OAuth application (`FORTYTWO_CLIENT_ID` / `FORTYTWO_CLIENT_SECRET`).
 *
 * The secret of a 42 application can expire or be regenerated on the intra. Nothing breaks until somebody
 * tries to sign in, and then Auth.js only says the sign-in failed. Asking 42 for a token of the application
 * itself (the `client_credentials` grant, which needs no member) tells "the application is refused" from
 * "42 is slow", so the login page can say what is wrong instead of "try again".
 *
 * Never throws, never waits more than a couple of seconds, and answers from a short-lived cache: the login
 * page calls it on every visit.
 */

export type FortyTwoCredentials = 'valid' | 'rejected' | 'unknown';

const TIMEOUT_MS = 2500;
/** How long an answer is kept. A refusal is rechecked sooner: whoever fixes it on the intra is waiting. */
const TTL_MS: Record<FortyTwoCredentials, number> = {
  valid: 10 * 60_000,
  rejected: 2 * 60_000,
  unknown: 30_000,
};

interface Cached {
  status: FortyTwoCredentials;
  until: number;
}

let cached: Cached | null = null;
let inFlight: Promise<FortyTwoCredentials> | null = null;

/** Forgets the last answer (for the tests). */
export function resetFortyTwoCredentialsCheck(): void {
  cached = null;
  inFlight = null;
}

async function ask(fetchImpl: typeof fetch): Promise<FortyTwoCredentials> {
  const clientId = setting('FORTYTWO_CLIENT_ID')?.trim();
  const clientSecret = setting('FORTYTWO_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) return 'unknown'; // refused at start-up already (env.ts)

  try {
    const response = await fetchImpl(`${fortyTwoApiBase()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (response.ok) return 'valid';
    if (response.status === 400 || response.status === 401) {
      const body: unknown = await response.json().catch(() => null);
      const error =
        typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
      if (error === 'invalid_client') return 'rejected';
    }
    return 'unknown'; // rate limit, outage, anything else: nothing is known about the application
  } catch {
    return 'unknown'; // no network, timeout
  }
}

export async function checkFortyTwoCredentials(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<FortyTwoCredentials> {
  if (cached && cached.until > now()) return cached.status;
  inFlight ??= ask(fetchImpl)
    .then((status) => {
      cached = { status, until: now() + TTL_MS[status] };
      return status;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** At start-up: says in the logs, once, when 42 refuses the application. Best effort, in the background. */
export function warnIfFortyTwoRejectsTheApplication(): void {
  void checkFortyTwoCredentials().then((status) => {
    if (status !== 'rejected') return;
    console.warn(
      "\n⚠️  42 refuse l'identifiant ou la clé secrète de l'application (FORTYTWO_CLIENT_ID / FORTYTWO_CLIENT_SECRET) :\n" +
        '    personne ne pourra se connecter. La clé a peut-être expiré ou été régénérée.\n' +
        '    → Vérifiez-la sur https://profile.intra.42.fr/oauth/applications, copiez-la dans .env,\n' +
        '      puis relancez : docker compose up -d\n',
    );
  });
}

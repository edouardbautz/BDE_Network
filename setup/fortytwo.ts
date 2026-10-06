/**
 * The 42 API, as much as the assistant needs it: check the credentials of the OAuth application
 * (client credentials flow), list the campuses, check that a login exists. `fetch` and the waiting
 * function are passed in, so the tests play the API without a network.
 */

const API = 'https://api.intra.42.fr';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type CredentialCheck =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate-limited' }
  | { ok: false; reason: 'network'; detail: string }
  | { ok: false; reason: 'unexpected'; status: number };

/** What is said about a network failure: the kind of error, never anything that was sent. */
function networkDetail(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  if (code) return code;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Asks the 42 API for a token with the application's own credentials. A 401 (`invalid_client`) means
 * the UID and the secret are not a valid pair. The secret only travels in the request body.
 */
export async function verifyCredentials(
  fetchFn: FetchLike,
  clientId: string,
  clientSecret: string,
): Promise<CredentialCheck> {
  let response: Response;
  try {
    response = await fetchFn(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (error) {
    return { ok: false, reason: 'network', detail: networkDetail(error) };
  }

  if (response.status === 401 || response.status === 400) return { ok: false, reason: 'invalid' };
  if (response.status === 429) return { ok: false, reason: 'rate-limited' };
  if (!response.ok) return { ok: false, reason: 'unexpected', status: response.status };

  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  return typeof body?.access_token === 'string'
    ? { ok: true, token: body.access_token }
    : { ok: false, reason: 'unexpected', status: response.status };
}

export interface Campus {
  id: number;
  /** The name 42 gives the campus: what `auth.allowedCampuses` is compared with. */
  name: string;
  country: string;
  /** IANA time zone of the campus, when 42 gives one. */
  timeZone: string | undefined;
}

interface RawCampus {
  id?: unknown;
  name?: unknown;
  country?: unknown;
  time_zone?: unknown;
}

const PAGE_SIZE = 100;
/** 42 allows two requests a second: one page every 600 ms is well under it. */
const PAGE_DELAY_MS = 600;

/** Every campus of the 42 network, sorted by name. Pages are fetched politely; a 429 is waited out. */
export async function listCampuses(
  fetchFn: FetchLike,
  token: string,
  sleep: Sleep = realSleep,
): Promise<Campus[] | null> {
  const campuses: Campus[] = [];
  for (let page = 1; page <= 10; page++) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchFn(
          `${API}/v2/campus?page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${page}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } catch {
        return null;
      }
      if (response.status !== 429) break;
      const wait = Number(response.headers.get('Retry-After'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 1500);
    }
    if (!response?.ok) return null;

    const rows = (await response.json().catch(() => null)) as RawCampus[] | null;
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (typeof row.id === 'number' && typeof row.name === 'string' && row.name.trim() !== '') {
        campuses.push({
          id: row.id,
          name: row.name.trim(),
          country: typeof row.country === 'string' ? row.country : '',
          timeZone: typeof row.time_zone === 'string' ? row.time_zone : undefined,
        });
      }
    }
    if (rows.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }

  return campuses.sort((a, b) => a.name.localeCompare(b.name));
}

export type LoginCheck = 'exists' | 'missing' | 'unknown';

/** Whether a 42 login exists. `unknown` when the API could not say (network, rate limit). */
export async function checkLogin(
  fetchFn: FetchLike,
  token: string,
  login: string,
  sleep: Sleep = realSleep,
): Promise<LoginCheck> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(`${API}/v2/users/${encodeURIComponent(login)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      return 'unknown';
    }
    if (response.status === 429) {
      await sleep(1500);
      continue;
    }
    if (response.status === 404) return 'missing';
    if (!response.ok) return 'unknown';
    const body = (await response.json().catch(() => null)) as { login?: unknown } | null;
    return typeof body?.login === 'string' ? 'exists' : 'unknown';
  }
  return 'unknown';
}

/** Lower-cases and strips accents, so "Montréal" is found by "montreal". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The campuses whose name contains `query` (accents and case ignored), best matches first. */
export function searchCampuses(campuses: readonly Campus[], query: string): Campus[] {
  const needle = fold(query);
  if (!needle) return [];
  return campuses
    .filter((campus) => fold(campus.name).includes(needle))
    .sort((a, b) => {
      const aStarts = fold(a.name).startsWith(needle) ? 0 : 1;
      const bStarts = fold(b.name).startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
}

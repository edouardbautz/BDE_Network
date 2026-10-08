import { setting } from '@/lib/settings/runtime';

/**
 * The address people use to reach the platform, in ONE place.
 *
 * The one that counts is the address registered in the settings (`APP_URL`, chosen in the installer, edited
 * on the settings page): it is also the one declared on the 42 intra as the redirect URL, so everything the
 * platform sends out (the redirect_uri of the sign-in, the links of the e-mails and of the Discord and Slack
 * cards, the pages Auth.js redirects to) must be built from it. What the server itself believes its address
 * is must never be used: inside the container it listens on `0.0.0.0`, which is where it accepts connections,
 * not a place anybody can visit (`http://0.0.0.0:3000` was what Next.js put in `request.url`, and what the
 * sign-in then sent to 42).
 */

/**
 * `0.0.0.0` (and the rest of `0.x.x.x`), `::`: "any address of this machine". A server listens there; nobody
 * can be told to go there, and 42 would never send anyone back to it.
 */
export function isUnspecifiedHost(host: string): boolean {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return /^0(\.\d{1,3}){0,3}$/.test(bare) || /^(0{0,4}:){2,7}0{0,4}$/.test(bare);
}

/**
 * `127.0.0.1` and `::1` are this computer, like `localhost`; Next.js itself rewrites them to `localhost` in
 * every `request.url` it builds. A redirect_uri sent on the way out as `127.0.0.1` and on the way back as
 * `localhost` would be refused by 42, so there is one spelling, `localhost`, everywhere an address is written.
 */
export function canonicalHost(host: string): string {
  const bare = host.trim().toLowerCase();
  return /^127(\.\d{1,3}){3}$/.test(bare) || bare === '[::1]' || bare === '::1'
    ? 'localhost'
    : bare;
}

/**
 * The registered address as an origin (`https://bde.exemple.fr`, `http://localhost:3000`: no path, no trailing
 * slash), or null when there is none or it is unusable (not http(s), or an unspecified host such as an older
 * installation may have saved). Null makes the callers fall back on the address of the request, so a wrong
 * value saved earlier cannot lock the sign-in.
 */
export function registeredAddress(): string | null {
  const configured = setting('APP_URL')?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isUnspecifiedHost(url.hostname)) return null;
    url.hostname = canonicalHost(url.hostname);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The address a request came by, from the headers the browser's request carried (what a reverse proxy
 * forwards, else `Host`). Only the fallback when no address is registered. An unspecified host (a browser
 * pointed at `http://0.0.0.0:3000`, which some of them accept) becomes `localhost`, never `0.0.0.0`.
 */
export function originOfRequest(headers: Pick<Headers, 'get'>): string {
  const first = (value: string | null): string | undefined =>
    value?.split(',')[0]?.trim() || undefined;
  const host =
    first(headers.get('x-forwarded-host')) ?? first(headers.get('host')) ?? 'localhost:3000';
  const protocol = first(headers.get('x-forwarded-proto'))?.replace(/:$/, '').toLowerCase();
  try {
    const url = new URL(`${protocol === 'https' ? 'https' : 'http'}://${host}`);
    url.hostname = isUnspecifiedHost(url.hostname) ? 'localhost' : canonicalHost(url.hostname);
    return url.origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/** This instance's address: the registered one, else the one the request came by. */
export function publicOrigin(headers: Pick<Headers, 'get'>): string {
  return registeredAddress() ?? originOfRequest(headers);
}

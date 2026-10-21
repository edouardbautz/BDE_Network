import { NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/public-address';

/**
 * Whether Auth.js can read a `callbackUrl` (what it checks, with the same rule: an `http(s)` address, a path being
 * read against the platform's own address). Anything else makes it answer a 500 and log an error for the request,
 * on the routes that are not pages (`/api/auth/callback/…`).
 */
export function isUsableCallbackUrl(value: string, origin: string): boolean {
  try {
    return /^https?:/.test(new URL(value, value.startsWith('/') ? origin : undefined).protocol);
  } catch {
    return false;
  }
}

/**
 * The same request, at the platform's public address.
 *
 * In the production image the server listens on `0.0.0.0`, and Next.js builds `request.url` from that:
 * `http://0.0.0.0:3000/api/auth/callback/42-school` while the browser asked for `localhost:3000`. Auth.js
 * derives everything it sends out from that URL (the `redirect_uri` given to 42 when the code is exchanged,
 * the pages it redirects to), so 42 refused the exchange ("does not match the redirection URI used in the
 * authorization request") and the visitor was sent to `0.0.0.0`. The address registered in the settings
 * replaces it (the address of the request when none is registered, never the listening one).
 *
 * A `callbackUrl` that Auth.js cannot read (`javascript:…`, a value with nothing to resolve) is dropped: it falls back
 * to the default, as if the visitor had not given one, instead of being a server error. Where it leads once it is
 * readable is Auth.js's rule, which only follows an address of the platform.
 */
export function atPublicOrigin(request: NextRequest): NextRequest {
  const { origin } = request.nextUrl;
  const wanted = publicOrigin(request.headers);
  const url = new URL(request.nextUrl.href.replace(origin, wanted));

  const callbackUrl = url.searchParams.get('callbackUrl');
  const dropped = callbackUrl !== null && !isUsableCallbackUrl(callbackUrl, wanted);
  if (dropped) url.searchParams.delete('callbackUrl');

  if (origin === wanted && !dropped) return request;
  return new NextRequest(url, request);
}

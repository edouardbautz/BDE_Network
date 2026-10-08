import { NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/public-address';

/**
 * The same request, at the platform's public address.
 *
 * In the production image the server listens on `0.0.0.0`, and Next.js builds `request.url` from that:
 * `http://0.0.0.0:3000/api/auth/callback/42-school` while the browser asked for `localhost:3000`. Auth.js
 * derives everything it sends out from that URL (the `redirect_uri` given to 42 when the code is exchanged,
 * the pages it redirects to), so 42 refused the exchange ("does not match the redirection URI used in the
 * authorization request") and the visitor was sent to `0.0.0.0`. The address registered in the settings
 * replaces it (the address of the request when none is registered, never the listening one).
 */
export function atPublicOrigin(request: NextRequest): NextRequest {
  const { href, origin } = request.nextUrl;
  const wanted = publicOrigin(request.headers);
  if (origin === wanted) return request;
  return new NextRequest(href.replace(origin, wanted), request);
}

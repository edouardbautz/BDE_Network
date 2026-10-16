/**
 * HTTP security headers sent with every response (wired in next.config.ts).
 *
 * The Content-Security-Policy keeps `'unsafe-inline'` for scripts and styles:
 * Next.js hydrates the page with inline scripts, next-themes sets the theme
 * with one, and the accent colour is an inline style. A nonce-based policy would
 * need every page to be rendered per request through the proxy; the rest of
 * the policy (no framing, no plugins, same-origin connections, a fixed list of
 * image hosts and form targets) is what protects an administration interface here.
 *
 * `upgrade-insecure-requests` is deliberately absent: a BDE that runs without an
 * HTTPS proxy (see docs/deployment.md) would have all its assets upgraded to
 * https and fail to load.
 */

/**
 * The one answer that sets a policy of its own: the logo (`src/app/api/logo/route.ts`) sends `default-src 'none'; sandbox`,
 * the strictest there is, because it is a file anybody can open and its bytes were uploaded. A header of `next.config.ts`
 * replaces the one a route sets, so the policy of the pages must leave this address out, or the logo ends up with a policy
 * that lets scripts run (found by the attacks of the quality campaign: the route's header never reached the browser).
 */
export const OWN_POLICY_PATH = '/api/logo';

export interface HeaderRule {
  source: string;
  has?: { type: 'header'; key: string; value: string }[];
  headers: { key: string; value: string }[];
}

/** Where 42 serves profile pictures (stored as `User.photoUrl`). */
const FORTYTWO_IMAGES = 'https://cdn.intra.42.fr';
/** Where the sign-in form sends the browser. */
const FORTYTWO_API = 'https://api.intra.42.fr';

export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // blob: only for the preview of the logo the owner has just chosen, before it is sent
    `img-src 'self' data: blob: ${FORTYTWO_IMAGES}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${FORTYTWO_API}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * `development` skips the CSP: React's dev tooling needs `eval` and a websocket
 * for hot reload. Everything else is sent in both modes.
 */
export function securityHeaders(mode: 'development' | 'production'): HeaderRule[] {
  const common = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ];

  const rules: HeaderRule[] = [{ source: '/:path*', headers: common }];

  if (mode === 'production') {
    rules.push({
      // Every path but the one that has a policy of its own (a negative lookahead, in the syntax of next.config.ts).
      source: `/((?!${OWN_POLICY_PATH.slice(1)}(?:/|$)).*)`,
      headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy() }],
    });
  }

  // Only when the request reached us over HTTPS (behind the proxy, which sets
  // X-Forwarded-Proto): browsers ignore HSTS on plain http anyway, and a BDE that
  // has no HTTPS proxy must not be told to insist on it. No includeSubDomains.
  if (mode === 'production') {
    rules.push({
      source: '/:path*',
      has: [{ type: 'header', key: 'x-forwarded-proto', value: 'https' }],
      headers: [{ key: 'Strict-Transport-Security', value: 'max-age=15552000' }],
    });
  }

  return rules;
}

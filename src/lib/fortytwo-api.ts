/**
 * Where the 42 API is. `FORTYTWO_API_URL` replaces it for the end-to-end tests (a small stand-in server,
 * e2e/mock-fortytwo.mjs): the installer's checks and the sign-in itself (authorization, token and profile
 * addresses of the provider) go there. It is not set in a real installation.
 */
export function fortyTwoApiBase(): string {
  const custom = process.env.FORTYTWO_API_URL?.trim().replace(/\/+$/, '');
  return custom || 'https://api.intra.42.fr';
}

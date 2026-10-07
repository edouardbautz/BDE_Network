/**
 * Where the 42 API is. `FORTYTWO_API_URL` replaces it for the end-to-end tests of the installer (a small
 * stand-in server): the sign-in itself (authorization, token and profile addresses of the provider) is
 * not affected, it is always the real 42.
 */
export function fortyTwoApiBase(): string {
  const custom = process.env.FORTYTWO_API_URL?.trim().replace(/\/+$/, '');
  return custom || 'https://api.intra.42.fr';
}

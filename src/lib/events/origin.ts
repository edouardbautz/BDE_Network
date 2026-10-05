import { headers } from 'next/headers';

/** Absolute URL of this instance: APP_URL when set, otherwise what the browser used. */
export async function getOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

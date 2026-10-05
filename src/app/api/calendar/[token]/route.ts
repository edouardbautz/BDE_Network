import { buildSubscriptionFeed } from '@/lib/events/export';

export const dynamic = 'force-dynamic';

/** Personal calendar subscription (Google Calendar, Outlook, Apple Calendar).
 * Authenticated only by the secret token in the URL. Every failure — unknown
 * token, disabled module, removed member — is the same bare 404, so the
 * endpoint reveals nothing about which tokens ever existed. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Clients are given the link with a ".ics" suffix; the token itself never contains a dot.
  const feed = await buildSubscriptionFeed(token.replace(/\.ics$/i, ''));

  if (feed === null) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  return new Response(feed, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="bde-events.ics"',
      // Must reflect revocations at once and must not be shared between users.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

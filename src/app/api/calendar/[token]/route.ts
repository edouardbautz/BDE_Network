import { buildSubscriptionFeed } from '@/lib/events/export';
import { calendarFeedResponse } from '@/lib/events/feed-response';

export const dynamic = 'force-dynamic';

/** Personal calendar subscription (Google Calendar, Outlook, Apple Calendar).
 * Authenticated only by the secret token in the URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Clients are given the link with a ".ics" suffix; the token itself never contains a dot.
  const feed = await buildSubscriptionFeed(token.replace(/\.ics$/i, ''));
  return calendarFeedResponse(feed, 'bde-events.ics');
}

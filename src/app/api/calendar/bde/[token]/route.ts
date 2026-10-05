import { buildBdeSubscriptionFeed } from '@/lib/events/export';
import { calendarFeedResponse } from '@/lib/events/feed-response';

export const dynamic = 'force-dynamic';

/** BDE-wide subscription feed, pasted once into the board's shared calendar.
 * Confirmed events only. Authenticated by the secret token in the URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await buildBdeSubscriptionFeed(token.replace(/\.ics$/i, ''));
  return calendarFeedResponse(feed, 'bde-shared-events.ics');
}

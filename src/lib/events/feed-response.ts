/** HTTP response for a calendar subscription feed. Every failure is the same
 * bare 404, so an endpoint never reveals whether a token ever existed. */
export function calendarFeedResponse(feed: string | null, filename: string): Response {
  if (feed === null) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  return new Response(feed, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}"`,
      // Must reflect revocations at once and must not be shared between users.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

import { getConfig } from '@/config';
import { getEventsAccess } from '@/lib/events/access';
import { buildCalendarIcs } from '@/lib/events/export';
import { icsFilename } from '@/lib/events/ics';
import { expandEvents } from '@/lib/events/occurrences';
import { getVisibleEvent } from '@/lib/events/queries';

export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

/** "Add to my calendar" for one event. With `?occ=<start ms>` it exports that
 * occurrence only; without it, the whole event (every occurrence of a series).
 * Same visibility rule as the pages: a draft is a 404 without the permission. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getEventsAccess();
  if (!access) {
    return notFound();
  }

  const { id } = await params;
  const event = await getVisibleEvent(id, access.canManage);
  if (!event) {
    return notFound();
  }

  const timeZone = getConfig().bde.timezone;
  const all = expandEvents([event], {
    timeZone,
    range: { from: new Date(0), to: new Date('2100-01-01T00:00:00Z') },
    includeDrafts: access.canManage,
  });

  const requested = new URL(request.url).searchParams.get('occ');
  const occurrences =
    requested === null
      ? all
      : all.filter((occurrence) => String(occurrence.start.getTime()) === requested);
  if (occurrences.length === 0) {
    return notFound();
  }

  return new Response(buildCalendarIcs(occurrences), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(event.title)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

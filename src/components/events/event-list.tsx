import { CalendarDays, MapPin, Repeat, Users } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { groupByLocalDay, parseDayKey } from '@/lib/events/calendar';
import { resolveCategory, type CategoryView } from '@/lib/events/categories';
import { formatDayHeading, formatTimeRange } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { CategoryBadge } from './category-badge';

interface EventRowsProps {
  occurrences: readonly OccurrenceView[];
  categories: readonly CategoryView[];
  timeZone: string;
}

/** One event line: time, title (link to the detail page), category, place, people. */
export async function EventRow({
  occurrence,
  categories,
  timeZone,
}: { occurrence: OccurrenceView } & Omit<EventRowsProps, 'occurrences'>) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('events')]);
  const category = resolveCategory(occurrence.categoryKey, categories);

  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
      <p className="text-muted-foreground w-full shrink-0 text-sm tabular-nums sm:w-44">
        {formatTimeRange(occurrence.start, occurrence.end, locale, timeZone)}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={{
              pathname: `/events/${occurrence.eventId}`,
              query: { occ: occurrence.start.getTime() },
            }}
            className="rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {occurrence.title}
          </Link>
          {occurrence.status === 'DRAFT' && <Badge variant="outline">{t('status.DRAFT')}</Badge>}
          {occurrence.isRecurring && (
            <Repeat className="text-muted-foreground size-3.5" aria-label={t('recurring')} />
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <CategoryBadge category={category} />
          {occurrence.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {occurrence.location}
            </span>
          )}
          {occurrence.assignees.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {occurrence.assignees.map((a) => a.name).join(', ')}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Occurrences grouped under a heading per local day, in chronological order. */
export async function EventList({ occurrences, categories, timeZone }: EventRowsProps) {
  const locale = await getLocale();
  // Group by the day each occurrence starts, so a late event is listed once.
  const byDay = groupByLocalDay(occurrences, timeZone);
  const seen = new Set<string>();
  const days = [...byDay.keys()].sort();

  return (
    <div className="flex flex-col gap-6">
      {days.map((key) => {
        const dayOccurrences = (byDay.get(key) ?? []).filter((o) => !seen.has(o.key));
        dayOccurrences.forEach((o) => seen.add(o.key));
        const day = parseDayKey(key);
        if (!day || dayOccurrences.length === 0) return null;

        return (
          <section key={key} aria-labelledby={`day-${key}`}>
            <h2
              id={`day-${key}`}
              className="text-muted-foreground border-b pb-2 text-sm font-medium first-letter:uppercase"
            >
              {formatDayHeading(day, locale)}
            </h2>
            <ul className="divide-y">
              {dayOccurrences.map((occurrence) => (
                <EventRow
                  key={occurrence.key}
                  occurrence={occurrence}
                  categories={categories}
                  timeZone={timeZone}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Empty state shared by the list, the day panel and the dashboard block. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <CalendarDays className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}

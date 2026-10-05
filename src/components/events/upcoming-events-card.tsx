import { CalendarDays } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { resolveCategory, type CategoryView } from '@/lib/events/categories';
import { formatTime } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { CategoryBadge } from './category-badge';
import { EmptyState } from './event-list';

interface UpcomingEventsCardProps {
  occurrences: readonly OccurrenceView[];
  categories: readonly CategoryView[];
  timeZone: string;
  canManage: boolean;
}

/** Dashboard block: the next few events. Rendered only when the module is enabled. */
export async function UpcomingEventsCard({
  occurrences,
  categories,
  timeZone,
  canManage,
}: UpcomingEventsCardProps) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('events')]);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="text-muted-foreground size-4" />
          {t('dashboard.title')}
        </CardTitle>
        <Button variant="ghost" size="sm" render={<Link href="/events" />}>
          {t('dashboard.viewAll')}
        </Button>
      </CardHeader>
      <CardContent>
        {occurrences.length === 0 ? (
          <EmptyState
            title={t('dashboard.emptyTitle')}
            description={t('dashboard.emptyDescription')}
            action={
              canManage ? (
                <Button size="sm" render={<Link href="/events/new" />}>
                  {t('new')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {occurrences.map((occurrence) => (
              <li
                key={occurrence.key}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
              >
                <p className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                  <span className="capitalize">{dateFormat.format(occurrence.start)}</span>{' '}
                  {formatTime(occurrence.start, locale, timeZone)}
                </p>
                <Link
                  href={{
                    pathname: `/events/${occurrence.eventId}`,
                    query: { occ: occurrence.start.getTime() },
                  }}
                  className="min-w-0 flex-1 truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {occurrence.title}
                </Link>
                <CategoryBadge
                  category={resolveCategory(occurrence.categoryKey, categories)}
                  className="text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

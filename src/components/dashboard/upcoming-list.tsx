import { CalendarDays } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { EmptyState } from '@/components/galets/empty-state';
import { cardLink, cardSurface, pillButton } from '@/components/galets/styles';
import { CategoryBadge } from '@/components/events/category-badge';
import { resolveCategory, type CategoryView } from '@/lib/events/categories';
import { formatTime } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { cn } from '@/lib/utils';

/** The date tile of a row (spec 5.3): the weekday in small capitals, the day in large figures. */
function DateTile({ date, locale, timeZone }: { date: Date; locale: string; timeZone: string }) {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(date);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }).format(date);
  return (
    <div
      aria-hidden="true"
      className="bg-surface-2 flex h-12.5 w-12 shrink-0 flex-col items-center justify-center rounded-md"
    >
      <span className="text-micro text-muted-foreground font-bold uppercase">
        {weekday.replace('.', '')}
      </span>
      <span className="text-title-3 tabular leading-none">{day}</span>
    </div>
  );
}

/** The next dates after the one the accent card shows (spec 5.3: a standard card, rows separated by a hairline). */
export async function UpcomingList({
  occurrences,
  categories,
  timeZone,
  canCreate,
  className,
}: {
  occurrences: readonly OccurrenceView[];
  categories: readonly CategoryView[];
  timeZone: string;
  canCreate: boolean;
  className?: string;
}) {
  const [locale, t, tEvents] = await Promise.all([
    getLocale(),
    getTranslations('events.dashboard'),
    getTranslations('events'),
  ]);

  return (
    <section aria-labelledby="upcoming-title" className={cn(cardSurface, className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="upcoming-title" className="text-card-title text-ink">
          {t('title')}
        </h2>
        <Link href="/events" className={cardLink}>
          {t('viewAll')}
        </Link>
      </div>

      {occurrences.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            canCreate ? (
              <Link href="/events/new" className={pillButton({ size: 'md' })}>
                {tEvents('new')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="mt-3.5">
          {occurrences.map((occurrence) => (
            <li key={occurrence.key} className="border-line border-t first:border-t-0">
              <Link
                href={{
                  pathname: `/events/${occurrence.eventId}`,
                  query: { occ: occurrence.originalStart.getTime() },
                }}
                className="hover:bg-surface-2 -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2.5 focus-visible:outline-offset-1"
              >
                <DateTile date={occurrence.start} locale={locale} timeZone={timeZone} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body-strong truncate">{occurrence.title}</span>
                  <span className="text-small text-muted-foreground tabular truncate">
                    {formatTime(occurrence.start, locale, timeZone)}
                    {occurrence.location ? ` · ${occurrence.location}` : ''}
                  </span>
                </span>
                <span className="hidden min-w-0 sm:block">
                  <CategoryBadge category={resolveCategory(occurrence.categoryKey, categories)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

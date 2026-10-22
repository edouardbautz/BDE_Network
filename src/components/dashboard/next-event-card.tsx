import { CalendarDays, MapPin, Users } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pillButton } from '@/components/galets/styles';
import { formatShortDate, formatTimeRange } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { daysFromToday } from '@/lib/events/relative';
import { cn } from '@/lib/utils';

/**
 * The one "moment" of the dashboard (spec 1.2): the next event, filled with the accent of the BDE. Every text on it is
 * `accent-on` at full strength, and its one button is the "on accent" variant. There is no gauge: the platform does not
 * count registrations.
 */
export async function NextEventCard({
  occurrence,
  now,
  timeZone,
  className,
}: {
  occurrence: OccurrenceView;
  now: Date;
  timeZone: string;
  className?: string;
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('dashboard.nextEvent')]);
  const days = daysFromToday(occurrence.start, now, timeZone);
  const when = days <= 0 ? t('today') : days === 1 ? t('tomorrow') : t('inDays', { count: days });

  return (
    <article
      aria-labelledby="next-event-title"
      className={cn(
        'bg-accent-fill text-accent-on accent-edge flex flex-col gap-4 rounded-xl p-5 sm:rounded-3xl sm:p-6',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="bg-accent-on-soft text-caption flex h-5.5 items-center rounded-pill px-2.5 font-extrabold">
          {t('label')}
        </span>
        <span className="text-caption font-extrabold">{when}</span>
      </div>

      <h2 id="next-event-title" className="text-display max-w-[28ch]">
        {occurrence.title}
      </h2>

      <ul className="text-body flex flex-col gap-1.5 font-semibold">
        <li className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-4.5 shrink-0" />
          <span>
            <span>{formatShortDate(occurrence.start, locale, timeZone)}</span>
            {' · '}
            <span className="tabular">
              {formatTimeRange(occurrence.start, occurrence.end, locale, timeZone)}
            </span>
          </span>
        </li>
        {occurrence.location && (
          <li className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="size-4.5 shrink-0" />
            <span className="min-w-0 truncate">{occurrence.location}</span>
          </li>
        )}
        {occurrence.assignees.length > 0 && (
          <li className="flex items-center gap-2">
            <Users aria-hidden="true" className="size-4.5 shrink-0" />
            <span className="min-w-0 truncate">
              {occurrence.assignees.map((assignee) => assignee.name).join(', ')}
            </span>
          </li>
        )}
      </ul>

      <div className="mt-1">
        <Link
          href={{
            pathname: `/events/${occurrence.eventId}`,
            query: { occ: occurrence.originalStart.getTime() },
          }}
          className={pillButton({ variant: 'onAccent', size: 'md' })}
        >
          {t('view')}
        </Link>
      </div>
    </article>
  );
}

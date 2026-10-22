import { CalendarDays, Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/galets/empty-state';
import { cardSurface } from '@/components/galets/styles';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import type { CalendarDay, MonthRef } from '@/lib/events/calendar';
import { resolveCategory, type CategoryView } from '@/lib/events/categories';
import { formatDayHeading, formatTime, formatTimeRange, weekdayLabels } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { eventsLinkQuery, type EventsQuery } from '@/lib/events/search-params';

const MAX_CHIPS = 3;
const MAX_DOTS = 4;

interface MonthCalendarProps {
  grid: CalendarDay[][];
  month: MonthRef;
  groups: Map<string, OccurrenceView[]>;
  categories: readonly CategoryView[];
  timeZone: string;
  /** `YYYY-MM-DD` of today and of the day selected for the side panel. */
  todayKey: string;
  selectedKey: string;
  query: EventsQuery;
  /**
   * Whether the person can create events (`events.propose` or `events.validate`): the "+" of a day and the "add" button of the day panel are
   * theirs only. Hiding them is a courtesy; `/events/new` and the action `createEvent` refuse anybody else.
   */
  canCreate: boolean;
}

/**
 * Monthly grid (docs/design.md, "Calendar"). Server-rendered and JavaScript-free: a day is a link that selects it (?day=). From `md`
 * up each cell lists its events as chips; below that the cell shrinks to coloured dots and the selected day's events are listed
 * under the grid, which stays readable on a phone instead of squeezing unreadable text into 45px columns. From `lg` the selected
 * day (today, by default) has a panel of its own beside the grid.
 *
 * A cell is `surface-2` with corners of 14, today is a pill of the accent in its number and a ring of the accent round the cell,
 * an event is a chip on the soft accent (the colour of its category is a dot, never the text), and one that is not confirmed is
 * in italic on `surface-3`.
 *
 * Whoever can create events also gets a quick way to add one on a day: a "+" in the corner of each cell (from `md`
 * up; it shows when the cell is hovered or holds the keyboard focus, and always on a touch screen), and, below `md`, an
 * "add on this day" button in the panel of the selected day. Both open the form on that day (`/events/new?date=`).
 */
export async function MonthCalendar({
  grid,
  month,
  groups,
  categories,
  timeZone,
  todayKey,
  selectedKey,
  query,
  canCreate,
}: MonthCalendarProps) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('events')]);
  const weekdays = weekdayLabels(locale);
  const weekdaysLong = weekdayLabels(locale, 'long');
  const selectedOccurrences = groups.get(selectedKey) ?? [];
  const selectedDay = grid.flat().find((day) => day.key === selectedKey);

  const dayHref = (day: CalendarDay) => ({
    pathname: '/events',
    query: eventsLinkQuery(query, {
      view: 'calendar',
      month,
      day: { year: day.year, month: day.month, day: day.day },
    }),
  });

  const addHref = (key: string) => ({ pathname: '/events/new', query: { date: key } });

  return (
    <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start">
      <div className={cn(cardSurface, 'p-3 sm:p-4.5 lg:min-w-0 lg:flex-1')}>
        <table className="w-full table-fixed border-separate border-spacing-1.5 text-body">
          <caption className="sr-only">{t('calendar.caption')}</caption>
          <thead>
            <tr>
              {weekdays.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  abbr={weekdaysLong[index]}
                  className="text-caption text-muted-foreground pb-1 text-center capitalize"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]?.key}>
                {week.map((day) => {
                  const occurrences = groups.get(day.key) ?? [];
                  const isToday = day.key === todayKey;
                  const isSelected = day.key === selectedKey;

                  return (
                    <td
                      key={day.key}
                      className={cn(
                        'group/cell relative h-14 rounded-md align-top md:h-28',
                        day.inMonth ? 'bg-surface-2' : 'bg-transparent',
                        isSelected && 'bg-accent-soft md:bg-surface-2',
                        isToday && '[box-shadow:var(--ring-today)]',
                      )}
                    >
                      <div className="flex h-full flex-col gap-1 p-1 md:p-1.75">
                        <Link
                          href={dayHref(day)}
                          aria-current={isToday ? 'date' : undefined}
                          aria-label={t('calendar.dayLabel', {
                            date: formatDayHeading(day, locale),
                            count: occurrences.length,
                          })}
                          className={cn(
                            'text-small tabular flex size-6.5 items-center justify-center self-start rounded-pill font-bold outline-none',
                            !day.inMonth && 'text-muted-foreground',
                            isToday && 'bg-accent-fill text-accent-on accent-edge',
                            isSelected &&
                              !isToday &&
                              'shadow-[inset_0_0_0_2px_var(--accent-ink)] md:shadow-none',
                          )}
                        >
                          {day.day}
                        </Link>

                        {canCreate && (
                          <Link
                            href={addHref(day.key)}
                            aria-label={t('calendar.addOnDay', {
                              date: formatDayHeading(day, locale),
                            })}
                            title={t('calendar.addOnDayShort')}
                            className="bg-surface text-ink elev-1 hover:bg-surface-3 absolute top-1 right-1 hidden size-6.5 items-center justify-center rounded-pill opacity-0 transition-opacity duration-(--dur-fast) outline-none group-focus-within/cell:opacity-100 [td:hover_&]:opacity-100 focus-visible:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100 md:flex"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </Link>
                        )}

                        <ul className="hidden min-w-0 flex-col gap-1 md:flex">
                          {occurrences.slice(0, MAX_CHIPS).map((occurrence) => {
                            const category = resolveCategory(occurrence.categoryKey, categories);
                            const confirmed = occurrence.status === 'CONFIRMED';
                            return (
                              <li key={occurrence.key} className="min-w-0">
                                <Link
                                  // A month shows a hundred events at most: prefetching each one would make the server draw a hundred pages
                                  // (the page of every event, with its dates) for a person who opens one of them.
                                  prefetch={false}
                                  href={{
                                    pathname: `/events/${occurrence.eventId}`,
                                    query: { occ: occurrence.originalStart.getTime() },
                                  }}
                                  title={`${occurrence.title} — ${category.label}${
                                    confirmed ? '' : ` — ${t(`status.${occurrence.status}`)}`
                                  }`}
                                  className={cn(
                                    // 24 px at least: a target smaller than that, with others a few pixels away, is hard to hit (WCAG 2.5.8)
                                    'text-micro flex min-h-6 min-w-0 items-center gap-1 rounded-xs px-1.75 py-0.75 font-bold outline-none',
                                    confirmed
                                      ? 'bg-accent-soft text-accent-ink hover:bg-accent-soft-hover'
                                      : 'bg-surface-3 text-ink italic',
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className="bg-muted-foreground size-1.5 shrink-0 rounded-pill"
                                    style={
                                      category.color
                                        ? { backgroundColor: category.color }
                                        : undefined
                                    }
                                  />
                                  <span className="tabular shrink-0">
                                    {formatTime(occurrence.start, locale, timeZone)}
                                  </span>
                                  <span className="truncate">{occurrence.title}</span>
                                </Link>
                              </li>
                            );
                          })}
                          {occurrences.length > MAX_CHIPS && (
                            <li>
                              <Link
                                href={dayHref(day)}
                                className="text-small text-muted-foreground hover:text-ink flex min-h-6 items-center rounded-xs px-1.75 outline-none"
                              >
                                {t('calendar.more', { count: occurrences.length - MAX_CHIPS })}
                              </Link>
                            </li>
                          )}
                        </ul>

                        {occurrences.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 md:hidden" aria-hidden>
                            {occurrences.slice(0, MAX_DOTS).map((occurrence) => {
                              const category = resolveCategory(occurrence.categoryKey, categories);
                              return (
                                <span
                                  key={occurrence.key}
                                  className="bg-muted-foreground size-1.5 rounded-pill"
                                  style={
                                    category.color ? { backgroundColor: category.color } : undefined
                                  }
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section
        className={cn(cardSurface, 'lg:w-75 lg:shrink-0')}
        aria-labelledby="selected-day-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="selected-day-heading" className="text-title-2 text-ink first-letter:uppercase">
            {selectedDay ? formatDayHeading(selectedDay, locale) : ''}
          </h2>
          {canCreate && selectedDay && (
            <Button
              variant="secondary"
              size="sm"
              className="md:hidden"
              render={<Link href={addHref(selectedDay.key)} id="add-on-selected-day" />}
            >
              <Plus data-icon="inline-start" />
              {t('calendar.addOnSelectedDay')}
            </Button>
          )}
        </div>
        {selectedOccurrences.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('calendar.dayEmpty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedOccurrences.map((occurrence) => {
              const category = resolveCategory(occurrence.categoryKey, categories);
              return (
                <li key={occurrence.key}>
                  <Link
                    href={{
                      pathname: `/events/${occurrence.eventId}`,
                      query: { occ: occurrence.originalStart.getTime() },
                    }}
                    className="bg-accent-soft hover:bg-accent-soft-hover flex flex-col gap-0.5 rounded-lg px-3.5 py-3 outline-none"
                  >
                    <span className="text-small text-muted-foreground tabular">
                      {formatTimeRange(occurrence.start, occurrence.end, locale, timeZone)}
                    </span>
                    <span className="text-body-strong text-ink">{occurrence.title}</span>
                    <span className="text-small text-muted-foreground">
                      {category.label}
                      {occurrence.location ? ` · ${occurrence.location}` : ''}
                      {occurrence.status === 'CONFIRMED'
                        ? ''
                        : ` · ${t(`status.${occurrence.status}`)}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

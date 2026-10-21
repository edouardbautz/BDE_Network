import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import type { CalendarDay, MonthRef } from '@/lib/events/calendar';
import { resolveCategory, type CategoryView } from '@/lib/events/categories';
import { formatDayHeading, formatTime, weekdayLabels } from '@/lib/events/format';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { eventsLinkQuery, type EventsQuery } from '@/lib/events/search-params';
import { EmptyState, EventRow } from './event-list';

const MAX_CHIPS = 3;
const MAX_DOTS = 4;

interface MonthCalendarProps {
  grid: CalendarDay[][];
  month: MonthRef;
  groups: Map<string, OccurrenceView[]>;
  categories: readonly CategoryView[];
  timeZone: string;
  /** `YYYY-MM-DD` of today and of the day selected for the mobile panel. */
  todayKey: string;
  selectedKey: string;
  query: EventsQuery;
  /**
   * Whether the person can create events (`events.propose` or `events.validate`): the "+" of a day and the "add" button of the day panel are
   * theirs only. Hiding them is a courtesy; `/events/new` and the action `createEvent` refuse anybody else.
   */
  canCreate: boolean;
}

/** Tint a category colour for a chip background without hardcoding any colour. */
const tint = (color: string | null) =>
  color
    ? { backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`, borderColor: color }
    : undefined;

/**
 * Monthly grid. Server-rendered and JavaScript-free: a day is a link that
 * selects it (?day=). From `md` up each cell lists its events as coloured
 * chips; below that the cell shrinks to coloured dots and the selected day's
 * events are listed under the grid, which stays readable on a phone instead
 * of squeezing unreadable text into 45px columns.
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
    <div className="flex flex-col gap-4">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t('calendar.caption')}</caption>
        <thead>
          <tr>
            {weekdays.map((label, index) => (
              <th
                key={label}
                scope="col"
                abbr={weekdaysLong[index]}
                className="text-muted-foreground pb-2 text-center text-xs font-medium capitalize"
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
                      'group/cell relative h-14 border align-top md:h-28',
                      !day.inMonth && 'bg-muted/40',
                      isSelected && 'bg-primary/5 md:bg-transparent',
                    )}
                  >
                    <div className="flex h-full flex-col gap-1 p-1 md:p-1.5">
                      <Link
                        href={dayHref(day)}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={t('calendar.dayLabel', {
                          date: formatDayHeading(day, locale),
                          count: occurrences.length,
                        })}
                        className={cn(
                          'flex size-6 items-center justify-center self-start rounded-full text-xs font-medium tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                          !day.inMonth && 'text-muted-foreground',
                          isToday && 'bg-primary text-primary-foreground',
                          isSelected && !isToday && 'ring-primary ring-2 md:ring-0',
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
                          className="border-input bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 absolute top-1 right-1 hidden size-6 items-center justify-center rounded-full border opacity-0 shadow-xs transition-opacity outline-none group-focus-within/cell:opacity-100 [td:hover_&]:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 pointer-coarse:size-8 pointer-coarse:opacity-100 md:flex"
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </Link>
                      )}

                      <ul className="hidden min-w-0 flex-col gap-0.5 md:flex">
                        {occurrences.slice(0, MAX_CHIPS).map((occurrence) => {
                          const category = resolveCategory(occurrence.categoryKey, categories);
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
                                  occurrence.status === 'CONFIRMED'
                                    ? ''
                                    : ` — ${t(`status.${occurrence.status}`)}`
                                }`}
                                style={tint(category.color)}
                                className={cn(
                                  // 24 px at least: a target smaller than that, with others a few pixels away, is hard to hit (WCAG 2.5.8)
                                  'hover:bg-muted flex min-h-6 min-w-0 items-center gap-1 rounded-sm border-l-2 px-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                                  !category.color && 'border-muted-foreground/40 bg-muted/50',
                                  // Not confirmed: dashed and italic. Never faded (an opacity lowers the contrast of the text).
                                  occurrence.status !== 'CONFIRMED' && 'border-dashed italic',
                                )}
                              >
                                <span className="text-muted-foreground shrink-0 tabular-nums">
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
                              className="text-muted-foreground hover:text-foreground flex min-h-6 items-center rounded-sm px-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
                                className="bg-muted-foreground/40 size-1.5 rounded-full"
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

      <section className="md:hidden" aria-labelledby="selected-day-heading">
        <div className="flex items-center justify-between gap-3 border-b pb-2">
          <h2
            id="selected-day-heading"
            className="text-muted-foreground text-sm font-medium first-letter:uppercase"
          >
            {selectedDay ? formatDayHeading(selectedDay, locale) : ''}
          </h2>
          {canCreate && selectedDay && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={addHref(selectedDay.key)} id="add-on-selected-day" />}
            >
              <Plus data-icon="inline-start" />
              {t('calendar.addOnSelectedDay')}
            </Button>
          )}
        </div>
        {selectedOccurrences.length === 0 ? (
          <EmptyState title={t('calendar.dayEmpty')} />
        ) : (
          <ul className="divide-y">
            {selectedOccurrences.map((occurrence) => (
              <EventRow
                key={occurrence.key}
                occurrence={occurrence}
                categories={categories}
                timeZone={timeZone}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

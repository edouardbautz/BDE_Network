import { CalendarSync, Plus } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, EventList } from '@/components/events/event-list';
import { EventsToolbar } from '@/components/events/events-toolbar';
import { MonthCalendar } from '@/components/events/month-calendar';
import { Link } from '@/i18n/navigation';
import { canManageSharedCalendar, getEventsAccess } from '@/lib/events/access';
import {
  buildMonthGrid,
  dayKey,
  gridRange,
  groupByLocalDay,
  today as todayOf,
} from '@/lib/events/calendar';
import { getCategories } from '@/lib/events/categories';
import { getFilterOptions, listOccurrences, listUpcomingOccurrences } from '@/lib/events/queries';
import { parseEventsQuery, type RawSearchParams } from '@/lib/events/search-params';
import { fromLocalDateTime } from '@/lib/events/time';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 100;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const access = await getEventsAccess();
  if (!access) {
    notFound();
  }

  const [t, raw] = await Promise.all([getTranslations('events'), searchParams]);
  const timeZone = getConfig().bde.timezone;
  const categories = getCategories();
  const now = new Date();
  const options = await getFilterOptions(access.canManage);

  const query = parseEventsQuery(raw, {
    now,
    timeZone,
    categoryKeys: categories.map((category) => category.key),
    schoolYears: options.schoolYears,
    assigneeLogins: options.assignees.map((member) => member.login),
  });

  const showCalendar = query.view !== 'list';
  const showList = query.view !== 'calendar';
  const hasFilters = Object.values(query.filters).some(Boolean);
  const today = todayOf(now, timeZone);
  const todayKey = dayKey(today);

  const createButton = access.canManage ? (
    <Button size="sm" render={<Link href="/events/new" />}>
      <Plus data-icon="inline-start" />
      {t('new')}
    </Button>
  ) : null;

  // Calendar data (only when the calendar can be shown)
  const grid = buildMonthGrid(query.month);
  const calendarOccurrences = showCalendar
    ? await listOccurrences({
        range: gridRange(grid, timeZone),
        includeDrafts: access.canManage,
        filters: query.filters,
      })
    : [];
  const groups = groupByLocalDay(calendarOccurrences, timeZone);
  const monthPrefix = `${query.month.year}-${String(query.month.month).padStart(2, '0')}`;
  const monthHasEvents = [...groups.keys()].some((key) => key.startsWith(monthPrefix));
  const defaultDay = todayKey.startsWith(monthPrefix) ? todayKey : `${monthPrefix}-01`;
  const requestedDay = query.day ? dayKey(query.day) : null;
  const selectedKey =
    requestedDay && grid.flat().some((day) => day.key === requestedDay) ? requestedDay : defaultDay;

  // List data (upcoming events, from the start of today in the BDE timezone)
  const upcoming = showList
    ? await listUpcomingOccurrences({
        now: fromLocalDateTime({ ...today, hour: 0, minute: 0 }, timeZone),
        limit: LIST_LIMIT,
        includeDrafts: access.canManage,
        filters: query.filters,
      })
    : [];

  // The BDE-wide calendar link is for OWNER and ADMIN, whatever their events permission.
  const sharedCalendarButton = canManageSharedCalendar(access.session.user.role) ? (
    <Button variant="outline" size="sm" render={<Link href="/events/shared-calendar" />}>
      <CalendarSync data-icon="inline-start" />
      {t('sharedCalendar.open')}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sharedCalendarButton}
          {createButton}
        </div>
      </div>

      <EventsToolbar
        query={query}
        categories={categories}
        options={options}
        showMonthNav={showCalendar}
        currentMonth={query.month}
      />

      {showCalendar && (
        <div className={query.view === undefined ? 'hidden md:block' : undefined}>
          <MonthCalendar
            grid={grid}
            month={query.month}
            groups={groups}
            categories={categories}
            timeZone={timeZone}
            todayKey={todayKey}
            selectedKey={selectedKey}
            query={query}
          />
          {!monthHasEvents && (
            <Card className="mt-4 border-dashed">
              <CardContent>
                <EmptyState
                  title={hasFilters ? t('empty.filteredTitle') : t('empty.monthTitle')}
                  description={
                    hasFilters ? t('empty.filteredDescription') : t('empty.monthDescription')
                  }
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {showList && (
        <div className={query.view === undefined ? 'md:hidden' : undefined}>
          {upcoming.length === 0 ? (
            <Card className="border-dashed">
              <CardContent>
                <EmptyState
                  title={hasFilters ? t('empty.filteredTitle') : t('empty.title')}
                  description={
                    hasFilters
                      ? t('empty.filteredDescription')
                      : access.canManage
                        ? t('empty.descriptionManager')
                        : t('empty.description')
                  }
                  action={hasFilters ? undefined : (createButton ?? undefined)}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EventList occurrences={upcoming} categories={categories} timeZone={timeZone} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

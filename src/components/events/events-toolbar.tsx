import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import { shiftMonth, type MonthRef } from '@/lib/events/calendar';
import type { CategoryView } from '@/lib/events/categories';
import { formatMonthTitle } from '@/lib/events/format';
import type { FilterOptions } from '@/lib/events/queries';
import { eventsLinkQuery, type EventsQuery } from '@/lib/events/search-params';
import { NativeSelect } from './field-styles';

interface EventsToolbarProps {
  query: EventsQuery;
  categories: readonly CategoryView[];
  options: FilterOptions;
  /** False in list view, where there is no month to navigate. */
  showMonthNav: boolean;
  currentMonth: MonthRef;
}

export async function EventsToolbar({
  query,
  categories,
  options,
  showMonthNav,
  currentMonth,
}: EventsToolbarProps) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('events')]);
  const hasFilters = Object.values(query.filters).some(Boolean);
  const activeView = query.view;

  const viewLink = (view: 'calendar' | 'list') => ({
    pathname: '/events',
    query: eventsLinkQuery(query, { view, month: view === 'calendar' ? query.month : undefined }),
  });
  const monthLink = (month: MonthRef) => ({
    pathname: '/events',
    query: eventsLinkQuery(query, { view: 'calendar', month }),
  });

  const tab = (view: 'calendar' | 'list', Icon: typeof List, label: string) => {
    // With no explicit choice nothing is "selected": the layout adapts to the screen.
    const selected = activeView === view;
    return (
      <Link
        href={viewLink(view)}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          selected
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <Icon className={cn('size-4', selected && 'text-primary')} aria-hidden />
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label={t('views.label')}
          className="flex items-center gap-1 rounded-lg border p-0.5"
        >
          {tab('calendar', CalendarDays, t('views.calendar'))}
          {tab('list', List, t('views.list'))}
        </nav>

        {showMonthNav && (
          <div
            className={cn(
              'items-center gap-1',
              activeView === undefined ? 'hidden md:flex' : 'flex',
            )}
          >
            <Button
              variant="outline"
              size="icon-sm"
              render={<Link href={monthLink(shiftMonth(currentMonth, -1))} />}
              aria-label={t('calendar.previous')}
            >
              <ChevronLeft />
            </Button>
            <h2 className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
              {formatMonthTitle(currentMonth, locale)}
            </h2>
            <Button
              variant="outline"
              size="icon-sm"
              render={<Link href={monthLink(shiftMonth(currentMonth, 1))} />}
              aria-label={t('calendar.next')}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              render={
                <Link
                  href={{
                    pathname: '/events',
                    query: eventsLinkQuery(query, { view: 'calendar' }),
                  }}
                />
              }
            >
              {t('calendar.today')}
            </Button>
          </div>
        )}
      </div>

      <form
        method="get"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,1fr)_auto]"
      >
        {activeView && <input type="hidden" name="view" value={activeView} />}
        {activeView !== 'list' && showMonthNav && (
          <input
            type="hidden"
            name="month"
            value={`${currentMonth.year}-${String(currentMonth.month).padStart(2, '0')}`}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">{t('filters.category')}</Label>
          <NativeSelect
            id="filter-category"
            name="category"
            defaultValue={query.filters.categoryKey ?? ''}
          >
            <option value="">{t('filters.allCategories')}</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-assignee">{t('filters.assignee')}</Label>
          <NativeSelect
            id="filter-assignee"
            name="assignee"
            defaultValue={query.filters.assigneeLogin ?? ''}
          >
            <option value="">{t('filters.allAssignees')}</option>
            {options.assignees.map((member) => (
              <option key={member.login} value={member.login}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-school-year">{t('filters.schoolYear')}</Label>
          <NativeSelect
            id="filter-school-year"
            name="schoolYear"
            defaultValue={query.filters.schoolYear ?? ''}
          >
            <option value="">{t('filters.allSchoolYears')}</option>
            {options.schoolYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary" size="lg">
            {t('filters.apply')}
          </Button>
          {hasFilters && (
            <Button
              variant="ghost"
              size="lg"
              render={
                <Link
                  href={{
                    pathname: '/events',
                    query: eventsLinkQuery(
                      { filters: {} },
                      { view: activeView, month: activeView === 'list' ? undefined : query.month },
                    ),
                  }}
                />
              }
            >
              {t('filters.reset')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

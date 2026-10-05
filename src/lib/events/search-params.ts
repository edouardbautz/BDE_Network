import {
  currentMonth,
  dayKey,
  monthKey,
  parseDayKey,
  parseMonthKey,
  type MonthRef,
} from './calendar';
import type { EventFilters } from './occurrences';
import type { LocalDate } from './time';

export type EventsView = 'calendar' | 'list';

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface EventsQuery {
  /** Explicit choice from the URL; undefined = responsive default
   * (calendar on desktop, list on mobile). */
  view: EventsView | undefined;
  month: MonthRef;
  /** Day selected in the calendar (drives the mobile day panel). */
  day: LocalDate | null;
  filters: EventFilters;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Reads the events page query string defensively: anything unknown or
 * malformed falls back to a default instead of erroring, and filter values
 * are checked against what actually exists so the URL can't smuggle in
 * arbitrary strings.
 */
export function parseEventsQuery(
  raw: RawSearchParams,
  options: {
    now: Date;
    timeZone: string;
    categoryKeys: readonly string[];
    schoolYears: readonly string[];
    assigneeLogins: readonly string[];
  },
): EventsQuery {
  const view = first(raw.view);
  const category = first(raw.category);
  const assignee = first(raw.assignee);
  const schoolYear = first(raw.schoolYear);

  return {
    view: view === 'calendar' || view === 'list' ? view : undefined,
    month: parseMonthKey(first(raw.month)) ?? currentMonth(options.now, options.timeZone),
    day: parseDayKey(first(raw.day)),
    filters: {
      categoryKey: category && options.categoryKeys.includes(category) ? category : undefined,
      assigneeLogin: assignee && options.assigneeLogins.includes(assignee) ? assignee : undefined,
      schoolYear: schoolYear && options.schoolYears.includes(schoolYear) ? schoolYear : undefined,
    },
  };
}

/** Query-string object for a link on the events page, keeping the active
 * filters and dropping empty values. */
export function eventsLinkQuery(
  query: Pick<EventsQuery, 'filters'>,
  overrides: { view?: EventsView; month?: MonthRef; day?: LocalDate } = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  if (overrides.view) result.view = overrides.view;
  if (overrides.month) result.month = monthKey(overrides.month);
  if (overrides.day) result.day = dayKey(overrides.day);
  if (query.filters.categoryKey) result.category = query.filters.categoryKey;
  if (query.filters.assigneeLogin) result.assignee = query.filters.assigneeLogin;
  if (query.filters.schoolYear) result.schoolYear = query.filters.schoolYear;
  return result;
}

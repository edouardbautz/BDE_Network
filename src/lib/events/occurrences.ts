import type { EventRecurrence, EventStatus } from '@/generated/prisma/client';
import { occurrencesInRange } from './recurrence';

/** What the occurrence layer needs from a stored event (see queries.ts). */
export interface EventRecord {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  recurrence: EventRecurrence;
  recurrenceUntil: Date | null;
  schoolYear: string;
  updatedAt: Date;
  assignees: { login: string; user: { fullName: string } | null }[];
  cancellations: { occurrenceStart: Date }[];
}

export interface EventFilters {
  categoryKey?: string;
  assigneeLogin?: string;
  schoolYear?: string;
}

/** One dated instance of an event — the unit every view displays. */
export interface OccurrenceView {
  /** Unique within a response: `${eventId}:${start ms}`. */
  key: string;
  eventId: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  start: Date;
  end: Date;
  isRecurring: boolean;
  schoolYear: string;
  updatedAt: Date;
  assignees: { login: string; name: string }[];
}

export function matchesFilters(event: EventRecord, filters: EventFilters): boolean {
  if (filters.categoryKey && event.categoryKey !== filters.categoryKey) return false;
  if (filters.schoolYear && event.schoolYear !== filters.schoolYear) return false;
  if (filters.assigneeLogin && !event.assignees.some((a) => a.login === filters.assigneeLogin)) {
    return false;
  }
  return true;
}

/**
 * Expands stored events into their occurrences overlapping [from, to),
 * dropping drafts unless `includeDrafts` and cancelled occurrences, sorted
 * chronologically. This is the single place visibility is decided for
 * everything built on occurrences (calendar, list, dashboard, .ics feed).
 */
export function expandEvents(
  events: readonly EventRecord[],
  options: {
    timeZone: string;
    range: { from: Date; to: Date };
    includeDrafts: boolean;
    filters?: EventFilters;
  },
): OccurrenceView[] {
  const views: OccurrenceView[] = [];

  for (const event of events) {
    if (event.status === 'DRAFT' && !options.includeDrafts) continue;
    if (!matchesFilters(event, options.filters ?? {})) continue;

    const cancelled = new Set(event.cancellations.map((c) => c.occurrenceStart.getTime()));
    const occurrences = occurrencesInRange(event, options.timeZone, options.range, cancelled);

    for (const occurrence of occurrences) {
      views.push({
        key: `${event.id}:${occurrence.start.getTime()}`,
        eventId: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        categoryKey: event.categoryKey,
        status: event.status,
        start: occurrence.start,
        end: occurrence.end,
        isRecurring: event.recurrence !== 'NONE',
        schoolYear: event.schoolYear,
        updatedAt: event.updatedAt,
        assignees: event.assignees.map((a) => ({
          login: a.login,
          name: a.user?.fullName ?? a.login,
        })),
      });
    }
  }

  return views.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title),
  );
}

import type { EventStatus } from '@/generated/prisma/client';
import { isRepeating } from './repeat';
import { resolveOccurrences, seriesKeyOf, type EventRecord } from './series';

export type { EventRecord } from './series';

/** What a reader sees of the events that are not published: everything (a validator), their own (somebody who
 * only proposes: `ownLogin`), nothing. */
export interface DraftVisibility {
  includeDrafts: boolean;
  ownLogin?: string;
}

export interface EventFilters {
  categoryKey?: string;
  assigneeLogin?: string;
  schoolYear?: string;
}

/** One dated instance of an event — the unit every view displays. */
export interface OccurrenceView {
  /** Unique within a response: `${eventId}:${original start ms}`. */
  key: string;
  eventId: string;
  /** Identifies the date in calendar files whatever row of a cut series holds it (see `seriesKeyOf`). */
  seriesKey: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryKey: string;
  status: EventStatus;
  start: Date;
  end: Date;
  /** Where the series puts the date, even if it was moved: what the pages put in `?occ=`. */
  originalStart: Date;
  isRecurring: boolean;
  /** The date has values of its own. */
  edited: boolean;
  schoolYear: string;
  updatedAt: Date;
  assignees: { login: string; name: string }[];
}

/**
 * Expands stored events into their occurrences overlapping [from, to), with each date's own values applied,
 * dropping cancelled dates and the dates that are not published (a draft or a proposal) unless `includeDrafts`, or
 * unless they are the reader's own (`ownLogin` is the author of the event). It is decided date by date: a
 * series can be confirmed with one date back to draft, or the other way round. Sorted chronologically. This is the single place visibility is decided for everything built on occurrences
 * (calendar, list, dashboard, .ics feed, reminders).
 */
export function expandEvents(
  events: readonly EventRecord[],
  options: {
    timeZone: string;
    range: { from: Date; to: Date };
    filters?: EventFilters;
  } & DraftVisibility,
): OccurrenceView[] {
  const { filters = {}, range } = options;
  const views: OccurrenceView[] = [];

  for (const event of events) {
    if (filters.schoolYear && event.schoolYear !== filters.schoolYear) continue;
    const isOwn = options.ownLogin !== undefined && event.authorLogin === options.ownLogin;

    for (const occurrence of resolveOccurrences(event, options.timeZone)) {
      if (occurrence.cancelled) continue;
      if (occurrence.status !== 'CONFIRMED' && !options.includeDrafts && !isOwn) continue;
      if (occurrence.end.getTime() <= range.from.getTime()) continue;
      if (occurrence.start.getTime() >= range.to.getTime()) continue;
      if (filters.categoryKey && occurrence.categoryKey !== filters.categoryKey) continue;
      if (
        filters.assigneeLogin &&
        !occurrence.assignees.some((a) => a.login === filters.assigneeLogin)
      ) {
        continue;
      }

      views.push({
        key: `${event.id}:${occurrence.originalStart.getTime()}`,
        eventId: event.id,
        seriesKey: seriesKeyOf(event),
        title: occurrence.title,
        description: occurrence.description,
        location: occurrence.location,
        categoryKey: occurrence.categoryKey,
        status: occurrence.status,
        start: occurrence.start,
        end: occurrence.end,
        originalStart: occurrence.originalStart,
        isRecurring: isRepeating(event),
        edited: occurrence.edited,
        schoolYear: event.schoolYear,
        updatedAt: occurrence.updatedAt,
        assignees: occurrence.assignees.map((a) => ({
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

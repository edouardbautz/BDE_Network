import { getConfig } from '@/config';
import type { Prisma } from '@/generated/prisma/client';
import { APPROVED_STATUSES } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { eventInclude, visibleTo } from './include';
import {
  expandEvents,
  type DraftVisibility,
  type EventFilters,
  type EventRecord,
  type OccurrenceView,
} from './occurrences';

const DAY_MS = 86_400_000;

/** The filters of the toolbar that the database can apply. A date can have its own category or members, so
 * these only keep the events that may match: expandEvents decides date by date. */
function filterWhere(filters: EventFilters | undefined): Prisma.EventWhereInput[] {
  const clauses: Prisma.EventWhereInput[] = [];
  if (filters?.schoolYear) clauses.push({ schoolYear: filters.schoolYear });
  if (filters?.categoryKey) {
    clauses.push({
      OR: [
        { categoryKey: filters.categoryKey },
        { occurrences: { some: { categoryKey: filters.categoryKey } } },
      ],
    });
  }
  if (filters?.assigneeLogin) {
    clauses.push({
      OR: [
        { assignees: { some: { login: filters.assigneeLogin } } },
        { occurrences: { some: { assignees: { some: { login: filters.assigneeLogin } } } } },
      ],
    });
  }
  return clauses;
}

/** Occurrences overlapping [from, to), visible to a user who can (or cannot) see what is not published.
 * Drafts and proposals are excluded by the database query *and* again by expandEvents, so a mistake in one
 * layer cannot leak one. */
export async function listOccurrences(
  options: {
    range: { from: Date; to: Date };
    filters?: EventFilters;
  } & DraftVisibility,
): Promise<OccurrenceView[]> {
  const { range } = options;
  const events: EventRecord[] = await prisma.event.findMany({
    where: {
      AND: [
        visibleTo(options),
        ...filterWhere(options.filters),
        {
          OR: [
            { recurrence: 'NONE', startsAt: { lt: range.to }, endsAt: { gt: range.from } },
            // Slight over-fetch: an occurrence can end after recurrenceUntil.
            {
              recurrence: { not: 'NONE' },
              startsAt: { lt: range.to },
              recurrenceUntil: { gte: new Date(range.from.getTime() - DAY_MS) },
            },
            // A date moved into the window, whatever the series says.
            { occurrences: { some: { startsAt: { lt: range.to }, endsAt: { gt: range.from } } } },
          ],
        },
      ],
    },
    include: eventInclude,
  });

  return expandEvents(events, {
    timeZone: getConfig().bde.timezone,
    range,
    includeDrafts: options.includeDrafts,
    ownLogin: options.ownLogin,
    filters: options.filters,
  });
}

/** The next occurrences starting at or after `now` (or still in progress). */
export async function listUpcomingOccurrences(
  options: {
    now: Date;
    limit: number;
    filters?: EventFilters;
  } & DraftVisibility,
): Promise<OccurrenceView[]> {
  // A series is bounded (see MAX_OCCURRENCES), so a generous horizon is enough.
  const to = new Date(options.now.getTime() + 800 * DAY_MS);
  const occurrences = await listOccurrences({
    range: { from: options.now, to },
    includeDrafts: options.includeDrafts,
    ownLogin: options.ownLogin,
    filters: options.filters,
  });
  return occurrences.slice(0, options.limit);
}

/** A single event with its assignees, cancelled dates and the dates that have values of their own, or null if
 * it does not exist *or the user may not see it* (a draft without permission is indistinguishable from a
 * missing event; a draft event with a date confirmed alone is visible, showing only that date). */
export async function getVisibleEvent(id: string, viewer: DraftVisibility) {
  const event = await prisma.event.findUnique({ where: { id }, include: eventInclude });
  if (
    !event ||
    (!viewer.includeDrafts &&
      !(viewer.ownLogin !== undefined && event.authorLogin === viewer.ownLogin) &&
      event.status !== 'CONFIRMED' &&
      !event.occurrences.some((own) => own.status === 'CONFIRMED'))
  ) {
    return null;
  }
  return event;
}

/** The proposals waiting for a validator, the oldest first: the events whose own status is PROPOSED (a proposal is
 * always the whole event, never one date of it). Only for somebody who can validate. */
export async function listProposals() {
  return prisma.event.findMany({
    where: { status: 'PROPOSED' },
    include: { ...eventInclude, author: { select: { fullName: true } } },
    orderBy: [{ proposedAt: 'asc' }, { startsAt: 'asc' }],
  });
}

/** How many proposals wait: the counter of the menu. */
export function countProposals(): Promise<number> {
  return prisma.event.count({ where: { status: 'PROPOSED' } });
}

export interface FilterOptions {
  schoolYears: string[];
  assignees: { login: string; name: string }[];
}

/** Values offered by the filter bar: school years that have events visible
 * to this user, and every approved member (anyone can be put in charge). */
export async function getFilterOptions(viewer: DraftVisibility): Promise<FilterOptions> {
  const [years, members] = await Promise.all([
    prisma.event.findMany({
      where: visibleTo(viewer),
      select: { schoolYear: true },
      distinct: ['schoolYear'],
      orderBy: { schoolYear: 'desc' },
    }),
    listAssignableMembers(),
  ]);
  return { schoolYears: years.map((y) => y.schoolYear), assignees: members };
}

/** Approved members who can be put in charge of an event. */
export async function listAssignableMembers(): Promise<{ login: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: { status: { in: [...APPROVED_STATUSES] } },
    select: { login: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  return users.map((user) => ({ login: user.login, name: user.fullName }));
}

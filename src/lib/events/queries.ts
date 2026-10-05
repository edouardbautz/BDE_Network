import { getConfig } from '@/config';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  expandEvents,
  type EventFilters,
  type EventRecord,
  type OccurrenceView,
} from './occurrences';

const DAY_MS = 86_400_000;

const eventInclude = {
  assignees: { select: { login: true, user: { select: { fullName: true } } } },
  cancellations: { select: { occurrenceStart: true } },
} satisfies Prisma.EventInclude;

function baseWhere(options: {
  includeDrafts: boolean;
  filters?: EventFilters;
}): Prisma.EventWhereInput {
  const { filters } = options;
  return {
    ...(options.includeDrafts ? {} : { status: 'CONFIRMED' as const }),
    ...(filters?.categoryKey ? { categoryKey: filters.categoryKey } : {}),
    ...(filters?.schoolYear ? { schoolYear: filters.schoolYear } : {}),
    ...(filters?.assigneeLogin ? { assignees: { some: { login: filters.assigneeLogin } } } : {}),
  };
}

/** Occurrences overlapping [from, to), visible to a user who can (or cannot)
 * see drafts. Drafts are excluded by the database query *and* again by
 * expandEvents, so a mistake in one layer cannot leak a draft. */
export async function listOccurrences(options: {
  range: { from: Date; to: Date };
  includeDrafts: boolean;
  filters?: EventFilters;
}): Promise<OccurrenceView[]> {
  const { range } = options;
  const events: EventRecord[] = await prisma.event.findMany({
    where: {
      ...baseWhere(options),
      startsAt: { lt: range.to },
      OR: [
        { recurrence: 'NONE', endsAt: { gt: range.from } },
        // Slight over-fetch: an occurrence can end after recurrenceUntil.
        {
          recurrence: { not: 'NONE' },
          recurrenceUntil: { gte: new Date(range.from.getTime() - DAY_MS) },
        },
      ],
    },
    include: eventInclude,
  });

  return expandEvents(events, {
    timeZone: getConfig().bde.timezone,
    range,
    includeDrafts: options.includeDrafts,
    filters: options.filters,
  });
}

/** The next occurrences starting at or after `now` (or still in progress). */
export async function listUpcomingOccurrences(options: {
  now: Date;
  limit: number;
  includeDrafts: boolean;
  filters?: EventFilters;
}): Promise<OccurrenceView[]> {
  // A series is bounded (see MAX_OCCURRENCES), so a generous horizon is enough.
  const to = new Date(options.now.getTime() + 800 * DAY_MS);
  const occurrences = await listOccurrences({
    range: { from: options.now, to },
    includeDrafts: options.includeDrafts,
    filters: options.filters,
  });
  return occurrences.slice(0, options.limit);
}

/** A single event with its assignees and cancelled occurrences, or null if it
 * does not exist *or the user may not see it* (a draft without permission is
 * indistinguishable from a missing event). */
export async function getVisibleEvent(id: string, includeDrafts: boolean) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      assignees: { select: { login: true, userId: true, user: { select: { fullName: true } } } },
      cancellations: { select: { occurrenceStart: true } },
    },
  });
  if (!event || (event.status === 'DRAFT' && !includeDrafts)) {
    return null;
  }
  return event;
}

export interface FilterOptions {
  schoolYears: string[];
  assignees: { login: string; name: string }[];
}

/** Values offered by the filter bar: school years that have events visible
 * to this user, and every approved member (anyone can be put in charge). */
export async function getFilterOptions(includeDrafts: boolean): Promise<FilterOptions> {
  const [years, members] = await Promise.all([
    prisma.event.findMany({
      where: includeDrafts ? {} : { status: 'CONFIRMED' },
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
    where: { role: { not: 'PENDING' } },
    select: { login: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  return users.map((user) => ({ login: user.login, name: user.fullName }));
}

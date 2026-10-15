import type { Prisma } from '@/generated/prisma/client';

// How an event is read from the database, shared by the queries and by the series operations (which read
// inside their own transaction). No database client here: it can be imported anywhere.

const assigneeSelect = { login: true, userId: true, user: { select: { fullName: true } } } as const;

/** What an event is read with: its members in charge, its cancelled dates and the dates that have values of
 * their own (see series.ts). */
export const eventInclude = {
  assignees: { select: assigneeSelect },
  cancellations: { select: { occurrenceStart: true } },
  occurrences: { include: { assignees: { select: assigneeSelect } } },
} satisfies Prisma.EventInclude;

/** A reader who cannot see drafts still sees a draft event's dates that were confirmed alone, and none of a
 * confirmed event's dates that went back to draft (told apart date by date in expandEvents). */
export const VISIBLE_WITHOUT_DRAFTS: Prisma.EventWhereInput = {
  OR: [{ status: 'CONFIRMED' }, { occurrences: { some: { status: 'CONFIRMED' } } }],
};

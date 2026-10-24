import { prisma } from '@/lib/prisma';
import { eventInclude } from './include';

// How the pages read the requests for the intra. The events come with what the intra content is made of (their dates, cancellations
// and own values); the content itself is worked out by the page with `intraReadiness`.

/** The most requests that wait a page draws, and the most recently answered ones it adds (a BDE has some hundreds of events a year). */
const WAITING_LIMIT = 300;
const ANSWERED_LIMIT = 50;

const requestInclude = {
  event: { include: { ...eventInclude, author: { select: { fullName: true } } } },
} as const;

/** Every request, those that wait for the staff first (the oldest first), then the others (the most recent first). */
export async function listIntraRequests() {
  const [waiting, answered] = await Promise.all([
    prisma.intraRequest.findMany({
      where: { status: { in: ['PENDING', 'OUTDATED'] } },
      include: requestInclude,
      orderBy: { requestedAt: 'asc' },
      take: WAITING_LIMIT,
    }),
    prisma.intraRequest.findMany({
      where: { status: { in: ['PUBLISHED', 'REFUSED'] } },
      include: requestInclude,
      orderBy: { updatedAt: 'desc' },
      take: ANSWERED_LIMIT,
    }),
  ]);
  return [...waiting, ...answered];
}

/** One request with its event, or null. */
export async function getIntraRequest(eventId: string) {
  return prisma.intraRequest.findUnique({ where: { eventId }, include: requestInclude });
}

/** What waits for the staff (a first publication, or an update): the counter of the menu. */
export function countIntraToDo(): Promise<number> {
  return prisma.intraRequest.count({ where: { status: { in: ['PENDING', 'OUTDATED'] } } });
}

/** Where the publication of an event stands, for its own page. */
export async function getIntraRequestOfEvent(eventId: string) {
  return prisma.intraRequest.findUnique({
    where: { eventId },
    select: {
      status: true,
      intraUrl: true,
      refusalComment: true,
      requestedAt: true,
      requestedByLogin: true,
      answeredAt: true,
      answeredByLogin: true,
    },
  });
}

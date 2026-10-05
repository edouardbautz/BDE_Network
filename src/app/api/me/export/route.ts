import { NextResponse } from 'next/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Every query below filters on this id; Prisma drops a filter set to
  // `undefined`, which would export other members' rows. getEffectiveSession
  // only returns an account that really exists, so there is always an id here.
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, auditLogActions, authoredEvents, assignedEvents] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        login: true,
        fullName: true,
        email: true,
        photoUrl: true,
        campus: true,
        status: true,
        role: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        // Only whether a personal calendar link exists; the secret itself is not exported.
        calendarToken: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId },
      select: { action: true, targetType: true, targetLabel: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.event.findMany({
      where: { authorId: userId },
      select: { title: true, status: true, startsAt: true, createdAt: true },
      orderBy: { startsAt: 'desc' },
    }),
    prisma.eventAssignee.findMany({
      where: { userId },
      select: { event: { select: { title: true, startsAt: true } } },
    }),
  ]);

  const { calendarToken, role, ...profile } = user;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exportedAt,
      user: { ...profile, role: role?.name ?? null },
      calendarFeedActive: calendarToken !== null,
      auditLogActions,
      events: {
        authored: authoredEvents,
        inChargeOf: assignedEvents.map((assignment) => assignment.event),
      },
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="donnees-${profile.login}.json"`,
    },
  });
}

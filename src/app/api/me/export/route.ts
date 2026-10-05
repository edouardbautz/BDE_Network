import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, modulePermissions, auditLogActions, authoredEvents, assignedEvents] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          login: true,
          fullName: true,
          email: true,
          photoUrl: true,
          campus: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          // Only whether a personal calendar link exists; the secret itself is not exported.
          calendarToken: true,
        },
      }),
      prisma.modulePermission.findMany({
        where: { userId },
        select: { module: true, grantedByLogin: true, createdAt: true },
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

  const { calendarToken, ...profile } = user;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exportedAt,
      user: profile,
      calendarFeedActive: calendarToken !== null,
      modulePermissions,
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

import { NextResponse } from 'next/server';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Every query below filters on this id; Prisma drops a filter set to
  // `undefined`, which would export other members' rows. getEffectiveSession
  // only returns an account that really exists, so there is always an id here.
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const userId = session.user.id;

  const [
    user,
    auditLogActions,
    auditLogAboutYou,
    authoredEvents,
    assignedEvents,
    assignedDates,
    cancelledDates,
    templatesEdited,
    templateVersions,
  ] = await Promise.all([
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
    // What was done to the account (approved, given a role…), by whom is left out: that is another person's data.
    prisma.auditLog.findMany({
      where: { targetType: 'User', targetId: userId },
      select: { action: true, targetLabel: true, createdAt: true },
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
    // The dates of a series the person is in charge of on their own, and the dates they cancelled.
    prisma.eventOccurrenceAssignee.findMany({
      where: { userId },
      select: {
        occurrence: { select: { occurrenceStart: true, event: { select: { title: true } } } },
      },
    }),
    prisma.eventCancellation.findMany({
      where: { cancelledById: userId },
      select: { occurrenceStart: true, createdAt: true, event: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    // What the person did to the notifications of the BDE: which they customised and when. What the templates say is the BDE's, not
    // the person's, and is left out; so is who else edited them.
    prisma.notificationTemplate.findMany({
      where: { updatedById: userId },
      select: { type: true, scope: true, version: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.notificationTemplateVersion.findMany({
      where: { authorId: userId },
      select: { type: true, scope: true, version: true, action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // The proposals this person refused are recorded under their login (the text a validator wrote is theirs). The login comes
  // from the account just read, never from the request: an empty one would drop the filter and export everybody's.
  const refusedProposals = user.login
    ? await prisma.event.findMany({
        where: { refusedByLogin: user.login },
        select: { title: true, refusedAt: true, refusalComment: true },
        orderBy: { refusedAt: 'desc' },
      })
    : [];

  // The people, roles and groups this person added to what the notifications can mention: recorded under their login too.
  const mentionsAdded = user.login
    ? await prisma.notificationMention.findMany({
        where: { createdByLogin: user.login },
        select: { platform: true, kind: true, key: true, label: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const { calendarToken, role, ...profile } = user;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exportedAt,
      user: { ...profile, role: role?.name ?? null },
      calendarFeedActive: calendarToken !== null,
      auditLogActions,
      auditLogAboutYou,
      events: {
        authored: authoredEvents,
        inChargeOf: assignedEvents.map((assignment) => assignment.event),
        datesInChargeOf: assignedDates.map((assignment) => ({
          title: assignment.occurrence.event.title,
          occurrenceStart: assignment.occurrence.occurrenceStart,
        })),
        cancelledDates: cancelledDates.map((cancellation) => ({
          title: cancellation.event.title,
          occurrenceStart: cancellation.occurrenceStart,
          cancelledAt: cancellation.createdAt,
        })),
        refusedProposals,
      },
      notifications: { templatesEdited, templateVersions, mentionsAdded },
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      // All a member's personal data: not for a cache, shared or not (a proxy in front of the platform, a browser shared with others).
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="donnees-${profile.login}.json"`,
    },
  });
}

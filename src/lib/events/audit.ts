import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { simulationAuditFields } from '@/lib/audit-fields';
import type { EventsAccess } from './access';

export type EventAuditAction =
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'event.status_change'
  | 'event.propose'
  | 'event.withdraw'
  | 'event.approve'
  | 'event.refuse'
  | 'event.occurrence_cancel'
  | 'event.occurrence_restore';

/** Records an events-module action under the real acting account. Pass the transaction (`client`) when the
 * action is one: the entry is then committed with it, or not at all. */
export async function auditEventAction(
  access: EventsAccess,
  action: EventAuditAction,
  event: { id: string; title: string },
  metadata: Record<string, Prisma.InputJsonValue> = {},
  client?: Parameters<typeof logAuditEvent>[1],
): Promise<void> {
  const { user } = access.session;
  const entry = {
    actorLogin: user.login,
    actorId: user.id,
    action,
    targetType: 'Event',
    targetId: event.id,
    targetLabel: event.title,
    metadata: { ...metadata, ...simulationAuditFields(access.session.simulatedAs) },
  };
  await (client ? logAuditEvent(entry, client) : logAuditEvent(entry));
}

/** What every audit entry about a series says on top of its own facts: whether the action bore on one date or on
 * that date and the following (`fromFirst`: the first date, so the whole series), and which date. An event that
 * does not repeat has none of it. */
export function seriesAuditFields(
  event: { recurrence: string; startsAt: Date },
  scope: 'occurrence' | 'following',
  occurrenceStart: Date,
): Record<string, Prisma.InputJsonValue> {
  if (event.recurrence === 'NONE') return {};
  return {
    scope,
    occurrenceStart: occurrenceStart.toISOString(),
    ...(scope === 'following' && occurrenceStart.getTime() === event.startsAt.getTime()
      ? { fromFirst: true }
      : {}),
  };
}

export type CalendarFeedAuditAction =
  'calendar_feed.enable' | 'calendar_feed.regenerate' | 'calendar_feed.disable';

/** Records an action on the BDE-wide calendar link. The token is deliberately
 * never part of the entry: the audit log is readable by every OWNER and must
 * not become a way to read the secret. */
export async function auditCalendarFeedAction(
  access: EventsAccess,
  action: CalendarFeedAuditAction,
  metadata: Record<string, Prisma.InputJsonValue> = {},
): Promise<void> {
  const { user } = access.session;
  await logAuditEvent({
    actorLogin: user.login,
    actorId: user.id,
    action,
    targetType: 'CalendarFeed',
    targetLabel: 'BDE',
    metadata: { ...metadata, ...simulationAuditFields(access.session.simulatedAs) },
  });
}

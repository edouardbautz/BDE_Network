import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { simulationAuditFields } from '@/lib/audit-fields';
import type { EventsAccess } from './access';

export type EventAuditAction =
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'event.status_change'
  | 'event.occurrence_cancel'
  | 'event.occurrence_restore';

/** Records an events-module action under the real acting account. */
export async function auditEventAction(
  access: EventsAccess,
  action: EventAuditAction,
  event: { id: string; title: string },
  metadata: Record<string, Prisma.InputJsonValue> = {},
): Promise<void> {
  const { user } = access.session;
  await logAuditEvent({
    actorLogin: user.login,
    actorId: user.id,
    action,
    targetType: 'Event',
    targetId: event.id,
    targetLabel: event.title,
    metadata: { ...metadata, ...simulationAuditFields(access.session.simulatedAs) },
  });
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

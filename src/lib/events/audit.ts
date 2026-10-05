import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { impersonationAuditFields } from '@/lib/auth/session';
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
    metadata: { ...metadata, ...impersonationAuditFields(access.session) },
  });
}

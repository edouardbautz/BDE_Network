import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { simulationAuditFields } from '@/lib/audit-fields';
import type { IntraAccess } from './access';
import type { IntraOutcome } from './intra-sync';

export type IntraAuditAction = 'intra.publish' | 'intra.update' | 'intra.refuse' | 'intra.request';

/** Records an answer to a request, or a request, under the real acting account, in the transaction of the action. */
export async function auditIntraAction(
  access: IntraAccess,
  action: IntraAuditAction,
  event: { id: string; title: string },
  metadata: Record<string, Prisma.InputJsonValue>,
  client: Parameters<typeof logAuditEvent>[1],
): Promise<void> {
  const { user } = access.session;
  await logAuditEvent(
    {
      actorLogin: user.login,
      actorId: user.id,
      action,
      targetType: 'Event',
      targetId: event.id,
      targetLabel: event.title,
      metadata: { ...metadata, ...simulationAuditFields(access.session.simulatedAs) },
    },
    client,
  );
}

/** What a change to an event did to the request for the intra, for the audit entry of that change (nothing: no key). */
export function intraAuditFields(
  outcomes: readonly IntraOutcome[],
): Record<string, Prisma.InputJsonValue> {
  return outcomes.length === 0 ? {} : { intra: outcomes.map((outcome) => outcome.kind) };
}

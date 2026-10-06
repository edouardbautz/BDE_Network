import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/** The database or a transaction: an entry written inside the transaction of the action it
 * records is committed with it, or not at all. */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

interface LogAuditEventInput {
  actorLogin: string;
  actorId?: string | null;
  /** Machine-readable action key, e.g. "member.approve", "permission.grant" */
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Records a sensitive action. Entries are never updated or deleted from the
 * app — the audit log is append-only by design. */
export async function logAuditEvent(
  input: LogAuditEventInput,
  client: AuditClient = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorLogin: input.actorLogin,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      metadata: input.metadata,
    },
  });
}

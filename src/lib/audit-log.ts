import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

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
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  await prisma.auditLog.create({
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

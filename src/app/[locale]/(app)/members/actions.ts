'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@/generated/prisma/client';
import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { getConfig } from '@/config';
import { canManageMembers, canManageModulePermissions } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/audit-log';

async function requireManager(): Promise<EffectiveSession> {
  const session = await getEffectiveSession();
  if (!session || !canManageMembers(session.user.role)) {
    throw new Error('Forbidden');
  }
  return session;
}

/** `actorLogin`/`actorId` always come from the real account — impersonation
 * only ever overrides `role` (see EffectiveSession) — so this just flags the
 * entry as having happened under a simulated role, it never hides who
 * really performed it. */
function impersonationMetadata(actor: EffectiveSession): Prisma.InputJsonValue | undefined {
  return actor.isImpersonating ? { simulatedAsRole: actor.user.role } : undefined;
}

export async function approveMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.update({
    where: { id: userId, role: 'PENDING' },
    data: { role: 'MEMBER' },
  });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.approve',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
    metadata: impersonationMetadata(actor),
  });

  revalidatePath('/members');
}

export async function rejectMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.delete({
    where: { id: userId, role: 'PENDING' },
  });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.reject',
    targetType: 'User',
    targetLabel: target.login,
    metadata: impersonationMetadata(actor),
  });

  revalidatePath('/members');
}

export async function removeMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === 'OWNER') {
    throw new Error('OWNER accounts can only be changed via bde.config.yml');
  }

  await prisma.user.delete({ where: { id: userId } });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.remove',
    targetType: 'User',
    targetLabel: target.login,
    metadata: impersonationMetadata(actor),
  });

  revalidatePath('/members');
}

/** Grants or revokes access to one business module for an approved member.
 * Only modules enabled in bde.config.yml can be granted; OWNER accounts
 * already have every module, so a row for them would be meaningless. */
export async function setModulePermission(
  userId: string,
  moduleKey: string,
  granted: boolean,
): Promise<void> {
  const actor = await requireManager();
  if (!canManageModulePermissions(actor.user.role)) {
    throw new Error('Forbidden');
  }

  if (!getConfig().modules.enabled.includes(moduleKey)) {
    throw new Error(`Module "${moduleKey}" is not enabled`);
  }

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === 'PENDING' || target.role === 'OWNER') {
    throw new Error('Module permissions only apply to approved, non-OWNER members');
  }

  if (granted) {
    await prisma.modulePermission.upsert({
      where: { userId_module: { userId, module: moduleKey } },
      update: {},
      create: {
        userId,
        module: moduleKey,
        grantedByLogin: actor.user.login,
        grantedById: actor.user.id,
      },
    });
  } else {
    await prisma.modulePermission.deleteMany({ where: { userId, module: moduleKey } });
  }

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: granted ? 'permission.grant' : 'permission.revoke',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
    metadata: {
      module: moduleKey,
      ...(actor.isImpersonating ? { simulatedAsRole: actor.user.role } : {}),
    },
  });

  revalidatePath('/members');
}

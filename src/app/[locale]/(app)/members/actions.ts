'use server';

import { revalidatePath } from 'next/cache';
import {
  getEffectiveSession,
  impersonationAuditFields,
  type EffectiveSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { can, MEMBERS_MANAGE } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/audit-log';

async function requireManager(): Promise<EffectiveSession> {
  const session = await getEffectiveSession();
  if (!session || !can(session.user, MEMBERS_MANAGE)) {
    throw new Error('Forbidden');
  }
  return session;
}

export async function approveMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const defaultRole = await prisma.role.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true },
  });
  if (!defaultRole) {
    throw new Error('There is no default role to give the new member');
  }

  const target = await prisma.user.update({
    where: { id: userId, status: 'PENDING' },
    data: { status: 'MEMBER', roleId: defaultRole.id },
  });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.approve',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
    metadata: { role: defaultRole.name, ...impersonationAuditFields(actor) },
  });

  revalidatePath('/members');
}

export async function rejectMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.delete({
    where: { id: userId, status: 'PENDING' },
  });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.reject',
    targetType: 'User',
    targetLabel: target.login,
    metadata: impersonationAuditFields(actor),
  });

  revalidatePath('/members');
}

export async function removeMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.status === 'OWNER') {
    throw new Error('OWNER accounts can only be changed via bde.config.yml');
  }

  await prisma.user.delete({ where: { id: userId } });

  await logAuditEvent({
    actorLogin: actor.user.login,
    actorId: actor.user.id,
    action: 'member.remove',
    targetType: 'User',
    targetLabel: target.login,
    metadata: impersonationAuditFields(actor),
  });

  revalidatePath('/members');
}

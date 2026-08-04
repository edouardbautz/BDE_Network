'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageMembers } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/audit-log';

async function requireManager() {
  const session = await auth();
  if (!session?.user || !canManageMembers(session.user.role)) {
    throw new Error('Forbidden');
  }
  return session.user;
}

export async function approveMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.update({
    where: { id: userId, role: 'PENDING' },
    data: { role: 'MEMBER' },
  });

  await logAuditEvent({
    actorLogin: actor.login,
    actorId: actor.id,
    action: 'member.approve',
    targetType: 'User',
    targetId: target.id,
    targetLabel: target.login,
  });

  revalidatePath('/members');
}

export async function rejectMember(userId: string): Promise<void> {
  const actor = await requireManager();

  const target = await prisma.user.delete({
    where: { id: userId, role: 'PENDING' },
  });

  await logAuditEvent({
    actorLogin: actor.login,
    actorId: actor.id,
    action: 'member.reject',
    targetType: 'User',
    targetLabel: target.login,
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
    actorLogin: actor.login,
    actorId: actor.id,
    action: 'member.remove',
    targetType: 'User',
    targetLabel: target.login,
  });

  revalidatePath('/members');
}

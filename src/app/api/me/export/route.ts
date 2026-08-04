import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, modulePermissions, auditLogActions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        login: true,
        fullName: true,
        email: true,
        photoUrl: true,
        campus: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.modulePermission.findMany({
      where: { userId },
      select: { module: true, grantedByLogin: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId },
      select: { action: true, targetType: true, targetLabel: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exportedAt, user, modulePermissions, auditLogActions }, null, 2);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="donnees-${user.login}.json"`,
    },
  });
}

import type { Prisma, UserStatus } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * The status (and role) an existing account has after signing in, given whether
 * bde.config.yml lists it as an owner right now. The config is the only source of
 * OWNER: it is granted when the login is listed and taken away when it is not.
 *
 * A former owner becomes an ordinary member with the default role. If there is no
 * default role (it cannot be deleted, but the database could have been edited by
 * hand), they go back to waiting for approval rather than holding anything by accident.
 */
export async function accountAfterLogin(
  existing: { status: UserStatus; roleId: string | null },
  isOwner: boolean,
): Promise<Pick<Prisma.UserUncheckedUpdateInput, 'status' | 'roleId'>> {
  if (isOwner) {
    return { status: 'OWNER', roleId: null };
  }
  if (existing.status !== 'OWNER') {
    return { status: existing.status, roleId: existing.roleId };
  }

  const fallback = await prisma.role.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  return fallback ? { status: 'MEMBER', roleId: fallback.id } : { status: 'PENDING', roleId: null };
}

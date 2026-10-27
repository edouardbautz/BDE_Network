import { prisma } from '@/lib/prisma';

/** Email addresses of the owners of the platform: who is told that the backups do not work. */
export async function emailsOfOwners(): Promise<string[]> {
  const owners = await prisma.user.findMany({
    where: { status: 'OWNER' },
    select: { email: true },
  });
  return owners.map((owner) => owner.email);
}

/**
 * Email addresses of everyone who holds `permission`: the owners (they hold everything), the
 * members whose role grants every permission, and the members whose role lists it. Used to tell the
 * people who can act on something (approve a request, run the events) when nobody more specific
 * is concerned.
 */
export async function emailsOfHolders(permission: string): Promise<string[]> {
  const holders = await prisma.user.findMany({
    where: {
      OR: [
        { status: 'OWNER' },
        {
          status: 'MEMBER',
          role: { OR: [{ allPermissions: true }, { permissions: { has: permission } }] },
        },
      ],
    },
    select: { email: true },
  });
  return holders.map((holder) => holder.email);
}

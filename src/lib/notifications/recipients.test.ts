import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: vi.fn() } } }));

const { prisma } = await import('@/lib/prisma');
const { emailsOfHolders } = await import('./recipients');

beforeEach(() => vi.clearAllMocks());

describe('emailsOfHolders', () => {
  it('asks for the owners, the roles with every permission, and the roles that list the permission', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await emailsOfHolders('events.manage');

    expect(prisma.user.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        OR: [
          { status: 'OWNER' },
          {
            status: 'MEMBER',
            role: { OR: [{ allPermissions: true }, { permissions: { has: 'events.manage' } }] },
          },
        ],
      },
      select: { email: true },
    });
  });

  it('returns the addresses, and only the addresses', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { email: 'a@x.fr' },
      { email: 'b@x.fr' },
    ] as never);

    await expect(emailsOfHolders('members.manage')).resolves.toEqual(['a@x.fr', 'b@x.fr']);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: vi.fn() } } }));

const { prisma } = await import('@/lib/prisma');
const { emailsOfHolders, emailsOfOwners } = await import('./recipients');

beforeEach(() => vi.clearAllMocks());

describe('emailsOfHolders', () => {
  it('asks for the owners, the roles with every permission, and the roles that list the permission', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await emailsOfHolders('events.validate');

    expect(prisma.user.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        OR: [
          { status: 'OWNER' },
          {
            status: 'MEMBER',
            role: { OR: [{ allPermissions: true }, { permissions: { has: 'events.validate' } }] },
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

describe('emailsOfOwners', () => {
  it('asks for the owners and nobody else (a role cannot make somebody one), and returns their addresses', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { email: 'a@x.fr' },
      { email: 'b@x.fr' },
    ] as never);

    expect(await emailsOfOwners()).toEqual(['a@x.fr', 'b@x.fr']);
    expect(prisma.user.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { status: 'OWNER' },
      select: { email: true },
    });
  });
});

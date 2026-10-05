import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, User } from '@/generated/prisma/client';
import type { Session } from 'next-auth';

/**
 * The pages already redirect PENDING/MEMBER away from /members, but a
 * server action is a separate HTTP entry point (a POST to a Next.js action
 * id) that a browser's URL bar can't reach but a crafted request could.
 * Each action must re-check permissions on its own — this proves it does,
 * and that no mutation or audit entry is produced when it doesn't.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: vi.fn(),
      delete: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/lib/auth');
const { prisma } = await import('@/lib/prisma');
const { logAuditEvent } = await import('@/lib/audit-log');
const { approveMember, rejectMember, removeMember } = await import('./actions');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function sessionFor(role: Role, login = 'test-login'): Session {
  return {
    user: {
      id: 'actor-1',
      login,
      role,
      campus: 'Paris',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function fakeUser(overrides: Partial<User>): User {
  return {
    id: 'target-1',
    login: 'newbie',
    fullName: 'New Bie',
    email: 'newbie@example.com',
    photoUrl: null,
    campus: 'Paris',
    role: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approveMember', () => {
  it.each<Role>(['PENDING', 'MEMBER'])(
    'rejects a %s actor without touching the database',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(approveMember('target-1')).rejects.toThrow('Forbidden');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(approveMember('target-1')).rejects.toThrow('Forbidden');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('succeeds for an ADMIN and logs the action under their real login', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN', 'real-admin'));
    vi.mocked(prisma.user.update).mockResolvedValue(fakeUser({ role: 'MEMBER' }));

    await approveMember('target-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1', role: 'PENDING' },
      data: { role: 'MEMBER' },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorLogin: 'real-admin', action: 'member.approve' }),
    );
  });
});

describe('rejectMember', () => {
  it.each<Role>(['PENDING', 'MEMBER'])(
    'rejects a %s actor without touching the database',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(rejectMember('target-1')).rejects.toThrow('Forbidden');

      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('succeeds for an OWNER and logs the action under their real login', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER', 'real-owner'));
    vi.mocked(prisma.user.delete).mockResolvedValue(fakeUser({}));

    await rejectMember('target-1');

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-1', role: 'PENDING' } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorLogin: 'real-owner', action: 'member.reject' }),
    );
  });
});

describe('removeMember', () => {
  it.each<Role>(['PENDING', 'MEMBER'])(
    'rejects a %s actor without touching the database',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(removeMember('target-1')).rejects.toThrow('Forbidden');

      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('succeeds for an ADMIN removing a MEMBER and logs it under their real login', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN', 'real-admin'));
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(
      fakeUser({ role: 'MEMBER', login: 'departing' }),
    );
    vi.mocked(prisma.user.delete).mockResolvedValue(
      fakeUser({ role: 'MEMBER', login: 'departing' }),
    );

    await removeMember('target-1');

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorLogin: 'real-admin', action: 'member.remove' }),
    );
  });
});

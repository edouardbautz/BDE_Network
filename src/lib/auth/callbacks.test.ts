import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JWT } from '@auth/core/jwt';
import type { Session, User } from 'next-auth';

/**
 * Removing a member deletes their User row, but the JWT in their browser stays
 * valid for up to 30 days. These callbacks are what turns that cookie into
 * "signed out" instead of "signed in as nobody" (a session without id or role,
 * which the permission helpers used to treat as an approved member).
 */

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

const { prisma } = await import('@/lib/prisma');
const { jwtCallback, sessionCallback } = await import('./callbacks');

const findUnique = vi.mocked(prisma.user.findUnique);

const dbUser = {
  id: 'u1',
  login: 'alice',
  fullName: 'Alice A',
  email: 'alice@example.org',
  photoUrl: null,
  campus: 'Paris',
  role: 'MEMBER',
};

function session(): Session {
  return {
    user: { name: 'alice', email: 'alice@example.org' },
    expires: '2099-01-01T00:00:00.000Z',
  } as Session;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jwtCallback', () => {
  it('stores the login at sign-in without another lookup', async () => {
    const token = await jwtCallback({ token: {} as JWT, user: { login: 'alice' } as User });

    expect(token).toEqual({ login: 'alice' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('keeps the session while the account still exists', async () => {
    findUnique.mockResolvedValue({ id: 'u1' } as never);
    const token: JWT = { login: 'alice' };

    await expect(jwtCallback({ token })).resolves.toBe(token);
    expect(findUnique).toHaveBeenCalledWith({ where: { login: 'alice' }, select: { id: true } });
  });

  it('ends the session once the account was removed', async () => {
    findUnique.mockResolvedValue(null);

    await expect(jwtCallback({ token: { login: 'ghost' } })).resolves.toBeNull();
  });

  it('ends a session whose token carries no login, without querying', async () => {
    await expect(jwtCallback({ token: {} })).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('sessionCallback', () => {
  it('fills the session from the database row', async () => {
    findUnique.mockResolvedValue(dbUser as never);

    const result = await sessionCallback({ session: session(), token: { login: 'alice' } });

    expect(result.user).toMatchObject({
      id: 'u1',
      login: 'alice',
      role: 'MEMBER',
      campus: 'Paris',
      name: 'Alice A',
    });
  });

  it('refuses instead of returning a half-filled session when the account is gone', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      sessionCallback({ session: session(), token: { login: 'ghost' } }),
    ).rejects.toThrow('No account');
  });

  it('refuses a token without a login, without querying', async () => {
    await expect(sessionCallback({ session: session(), token: {} })).rejects.toThrow('No account');
    expect(findUnique).not.toHaveBeenCalled();
  });
});

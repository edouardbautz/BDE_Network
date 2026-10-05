import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor } from '@/test/session-fixtures';

/**
 * Uses the REAL dev-impersonation module (env checks + role validation are
 * not mocked away) so these tests exercise the actual production-inertness
 * guarantee, not a stand-in for it.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { role: { findUnique: vi.fn() } } }));

const { auth } = await import('@/lib/auth');
const { prisma } = await import('@/lib/prisma');
const { cookies } = await import('next/headers');
const { revalidatePath } = await import('next/cache');
const { DEV_IMPERSONATION_COOKIE } = await import('./dev-impersonation');
const { startImpersonation, stopImpersonation } = await import('./dev-impersonation-actions');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function fakeCookieStore() {
  return { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startImpersonation / stopImpersonation', () => {
  it('is inert in production even with a real OWNER session and the flag on', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await expect(startImpersonation('PENDING')).rejects.toThrow('disabled');
    await expect(stopImpersonation()).rejects.toThrow('disabled');

    expect(auth).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('is inert when the opt-in flag is missing, even outside production', async () => {
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', '');
    mockAuth.mockResolvedValue(sessionFor('OWNER'));

    await expect(startImpersonation('PENDING')).rejects.toThrow('disabled');
    expect(auth).not.toHaveBeenCalled();
  });

  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(startImpersonation('PENDING')).rejects.toThrow('Forbidden');
  });

  it('rejects a real ADMIN (a member, even with all permissions) — only the real OWNER may switch roles', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN'));

    await expect(startImpersonation('PENDING')).rejects.toThrow('Forbidden');
  });

  it.each(['SUPERADMIN', 'MEMBER', 'role:', 'role:bad id'])(
    'rejects the invalid choice %j for a real OWNER',
    async (choice) => {
      mockAuth.mockResolvedValue(sessionFor('OWNER'));

      await expect(startImpersonation(choice)).rejects.toThrow('Invalid role');
    },
  );

  it('rejects a role that does not exist, without setting any cookie', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(prisma.role.findUnique).mockResolvedValue(null);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await expect(startImpersonation('role:deleted')).rejects.toThrow('Invalid role');
    expect(store.set).not.toHaveBeenCalled();
  });

  it('rejects impersonating OWNER itself', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));

    await expect(startImpersonation('OWNER')).rejects.toThrow('Invalid role');
  });

  it('sets the cookie for a real OWNER and an existing role', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(prisma.role.findUnique).mockResolvedValue({ id: 'role-member' } as never);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await startImpersonation('role:role-member');

    expect(store.set).toHaveBeenCalledWith(
      DEV_IMPERSONATION_COOKIE,
      'role:role-member',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('sets the cookie to simulate a pending account', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await startImpersonation('PENDING');

    expect(store.set).toHaveBeenCalledWith(
      DEV_IMPERSONATION_COOKIE,
      'PENDING',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(prisma.role.findUnique).not.toHaveBeenCalled();
  });

  it('clears the cookie on stopImpersonation for a real OWNER', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await stopImpersonation();

    expect(store.delete).toHaveBeenCalledWith(DEV_IMPERSONATION_COOKIE);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

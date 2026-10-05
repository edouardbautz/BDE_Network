import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor } from '@/test/session-fixtures';

/**
 * getEffectiveSession() is the single choke point every page/action uses
 * instead of auth() — proves it only ever overrides the access fields (status,
 * role, permissions), only for a real OWNER, only when enabled, never touches
 * login/id/campus/etc., and treats a session without a real account as no session.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })) }));
vi.mock('@/lib/prisma', () => ({ prisma: { role: { findUnique: vi.fn() } } }));
vi.mock('@/lib/dev-impersonation', () => ({
  isDevImpersonationEnabled: vi.fn(),
  getImpersonation: vi.fn(),
}));

const { auth } = await import('@/lib/auth');
const { prisma } = await import('@/lib/prisma');
const { isDevImpersonationEnabled, getImpersonation } = await import('@/lib/dev-impersonation');
const { getEffectiveSession, impersonationAuditFields } = await import('./session');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

const treasurer = {
  id: 'role-treasurer',
  name: 'Trésorier',
  permissions: ['events.view', 'events.manage'],
  allPermissions: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEffectiveSession', () => {
  it('returns null when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(getEffectiveSession()).resolves.toBeNull();
  });

  // The session of an account that no longer exists has no id/login/status. It
  // must read as "not signed in", never as a user with an unknown status.
  it.each([
    ['an id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['a login', { login: undefined }],
    ['a status', { status: undefined }],
    ['a known status', { status: 'GUEST' }],
    ['resolved permissions', { permissions: undefined }],
    ['a role, for a member', { roleId: null }],
  ])('returns null when the session user has no %s', async (_label, override) => {
    mockAuth.mockResolvedValue({
      ...sessionFor('MEMBER'),
      user: { ...sessionFor('MEMBER').user, ...override },
    } as Session);

    await expect(getEffectiveSession()).resolves.toBeNull();
  });

  it('returns null for the bare session left by a removed account (name/email only)', async () => {
    mockAuth.mockResolvedValue({
      user: { name: 'ghost', email: 'ghost@example.org' },
      expires: '2099-01-01T00:00:00.000Z',
    } as Session);
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);

    await expect(getEffectiveSession()).resolves.toBeNull();
    expect(getImpersonation).not.toHaveBeenCalled();
  });

  it('accepts an owner and a pending account, which have no role', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    await expect(getEffectiveSession()).resolves.toMatchObject({ realStatus: 'OWNER' });
    mockAuth.mockResolvedValue(sessionFor('PENDING'));
    await expect(getEffectiveSession()).resolves.toMatchObject({ realStatus: 'PENDING' });
  });

  it('passes the real session through unchanged when impersonation is disabled', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(false);

    const result = await getEffectiveSession();

    expect(result).toEqual({
      user: sessionFor('OWNER').user,
      isImpersonating: false,
      simulatedAs: null,
      realStatus: 'OWNER',
    });
    expect(getImpersonation).not.toHaveBeenCalled();
  });

  it('never simulates anything for a real non-OWNER, even when enabled', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonation).mockResolvedValue({ kind: 'pending' });

    const result = await getEffectiveSession();

    expect(result?.user.roleName).toBe('Admin');
    expect(result?.isImpersonating).toBe(false);
    expect(getImpersonation).not.toHaveBeenCalled();
  });

  it('simulates a custom role for a real OWNER: only the access fields change, login/id stay real', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER', 'real-owner', 'owner-1'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonation).mockResolvedValue({ kind: 'role', roleId: 'role-treasurer' });
    vi.mocked(prisma.role.findUnique).mockResolvedValue(treasurer as never);

    const result = await getEffectiveSession();

    expect(result?.user).toMatchObject({
      login: 'real-owner',
      id: 'owner-1',
      campus: 'Paris',
      status: 'MEMBER',
      roleId: 'role-treasurer',
      roleName: 'Trésorier',
      holdsAll: false,
    });
    expect(result?.user.permissions).toEqual(['events.manage', 'events.view']);
    expect(result?.isImpersonating).toBe(true);
    expect(result?.simulatedAs).toBe('Trésorier');
    expect(result?.realStatus).toBe('OWNER');
  });

  it('simulates a pending account for a real OWNER, with no permission at all', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonation).mockResolvedValue({ kind: 'pending' });

    const result = await getEffectiveSession();

    expect(result?.user).toMatchObject({ status: 'PENDING', roleId: null, permissions: [] });
    expect(result?.simulatedAs).toBe('PENDING');
    expect(result?.realStatus).toBe('OWNER');
  });

  it('ignores a simulation of a role that no longer exists', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonation).mockResolvedValue({ kind: 'role', roleId: 'deleted' });
    vi.mocked(prisma.role.findUnique).mockResolvedValue(null);

    const result = await getEffectiveSession();

    expect(result?.user.status).toBe('OWNER');
    expect(result?.isImpersonating).toBe(false);
  });

  it('is a no-op for a real OWNER with no active simulation', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonation).mockResolvedValue(null);

    const result = await getEffectiveSession();

    expect(result?.user.status).toBe('OWNER');
    expect(result?.isImpersonating).toBe(false);
  });
});

describe('impersonationAuditFields', () => {
  it('flags the simulated role, and nothing otherwise', () => {
    const base = {
      user: sessionFor('OWNER').user,
      isImpersonating: false,
      realStatus: 'OWNER' as const,
    };
    expect(impersonationAuditFields({ ...base, simulatedAs: null })).toEqual({});
    expect(
      impersonationAuditFields({ ...base, isImpersonating: true, simulatedAs: 'Trésorier' }),
    ).toEqual({
      simulatedAsRole: 'Trésorier',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import type { Session } from 'next-auth';

/**
 * getEffectiveSession() is the single choke point every page/action uses
 * instead of auth() — proves it only ever overrides `role`, only for a real
 * OWNER, only when enabled, and never touches login/id/campus/etc.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/dev-impersonation', () => ({
  isDevImpersonationEnabled: vi.fn(),
  getImpersonationCookieRole: vi.fn(),
}));

const { auth } = await import('@/lib/auth');
const { isDevImpersonationEnabled, getImpersonationCookieRole } =
  await import('@/lib/dev-impersonation');
const { getEffectiveSession } = await import('./session');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: {
      id: 'owner-1',
      login: 'real-owner',
      role,
      campus: 'Paris',
      name: 'Real Owner',
      email: 'owner@example.com',
      image: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEffectiveSession', () => {
  it('returns null when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(getEffectiveSession()).resolves.toBeNull();
  });

  // The session of an account that no longer exists has no id/login/role. It
  // must read as "not signed in", never as a user with an unknown role.
  it.each([
    ['an id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['a login', { login: undefined }],
    ['a role', { role: undefined }],
    ['a known role', { role: 'GUEST' }],
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
    expect(getImpersonationCookieRole).not.toHaveBeenCalled();
  });

  it('passes the real session through unchanged when impersonation is disabled', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(false);

    const result = await getEffectiveSession();

    expect(result).toEqual({
      user: sessionFor('OWNER').user,
      isImpersonating: false,
      realRole: 'OWNER',
    });
    expect(getImpersonationCookieRole).not.toHaveBeenCalled();
  });

  it('never overrides the role for a real non-OWNER, even when enabled', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);

    const result = await getEffectiveSession();

    expect(result?.user.role).toBe('ADMIN');
    expect(result?.isImpersonating).toBe(false);
    expect(getImpersonationCookieRole).not.toHaveBeenCalled();
  });

  it('overrides only `role` for a real OWNER actively impersonating — login/id stay real', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonationCookieRole).mockResolvedValue('MEMBER');

    const result = await getEffectiveSession();

    expect(result?.user.role).toBe('MEMBER');
    expect(result?.user.login).toBe('real-owner');
    expect(result?.user.id).toBe('owner-1');
    expect(result?.isImpersonating).toBe(true);
    expect(result?.realRole).toBe('OWNER');
  });

  it('is a no-op for a real OWNER with no active impersonation cookie', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    vi.mocked(getImpersonationCookieRole).mockResolvedValue(null);

    const result = await getEffectiveSession();

    expect(result?.user.role).toBe('OWNER');
    expect(result?.isImpersonating).toBe(false);
  });
});

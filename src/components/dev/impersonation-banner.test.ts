import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import type { Session } from 'next-auth';

/**
 * The banner is the "no UI element in production" half of the guarantee —
 * proves it resolves to null (no markup at all) unless dev impersonation is
 * enabled AND the real signed-in user is OWNER, and that it short-circuits
 * before even calling auth() when disabled.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/dev-impersonation', () => ({
  isDevImpersonationEnabled: vi.fn(),
  getImpersonationCookieRole: vi.fn(),
}));
vi.mock('@/lib/dev-impersonation-actions', () => ({
  startImpersonation: vi.fn(),
  stopImpersonation: vi.fn(),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { auth } = await import('@/lib/auth');
const { isDevImpersonationEnabled, getImpersonationCookieRole } =
  await import('@/lib/dev-impersonation');
const { ImpersonationBanner } = await import('./impersonation-banner');

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

describe('ImpersonationBanner', () => {
  it('renders nothing when disabled, without even checking who is signed in', async () => {
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(false);

    await expect(ImpersonationBanner()).resolves.toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no session', async () => {
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    mockAuth.mockResolvedValue(null);

    await expect(ImpersonationBanner()).resolves.toBeNull();
  });

  it('renders nothing for a real non-OWNER, even when enabled', async () => {
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    mockAuth.mockResolvedValue(sessionFor('MEMBER'));

    await expect(ImpersonationBanner()).resolves.toBeNull();
  });

  it('renders the role switcher for a real OWNER with no active impersonation', async () => {
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(getImpersonationCookieRole).mockResolvedValue(null);

    await expect(ImpersonationBanner()).resolves.toBeTruthy();
  });

  it('renders the active-mode banner for a real OWNER currently impersonating', async () => {
    vi.mocked(isDevImpersonationEnabled).mockReturnValue(true);
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(getImpersonationCookieRole).mockResolvedValue('MEMBER');

    await expect(ImpersonationBanner()).resolves.toBeTruthy();
  });
});

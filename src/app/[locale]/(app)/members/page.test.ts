import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import type { Session } from 'next-auth';

/**
 * Proves that hitting /members directly (no menu, no click) is blocked for
 * any role below ADMIN, and that no member data is ever fetched for a
 * rejected request — a redirect alone isn't enough if the query already ran.
 */

const { RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  }
  return { RedirectSignal };
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((opts: { href: string }) => {
    throw new RedirectSignal(opts.href);
  }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    modulePermission: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => Object.assign((key: string) => key, { has: () => true })),
}));

const { auth } = await import('@/lib/auth');
const { redirect } = await import('@/i18n/navigation');
const { prisma } = await import('@/lib/prisma');
const { default: MembersPage } = await import('./page');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function sessionFor(role: Role): Session {
  return {
    user: {
      id: 'user-1',
      login: 'test-login',
      role,
      campus: 'Paris',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function callPage() {
  return MembersPage({ params: Promise.resolve({ locale: 'fr' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
});

describe('MembersPage — direct URL access control', () => {
  it.each<Role>(['PENDING', 'MEMBER'])(
    'redirects a %s user to /dashboard without querying the member list',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(callPage()).rejects.toThrow(RedirectSignal);

      expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/dashboard' }));
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    },
  );

  it('redirects when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(callPage()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/dashboard' }));
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it.each<Role>(['ADMIN', 'OWNER'])(
    'lets a %s user through and loads the member list',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(callPage()).resolves.toBeTruthy();

      expect(redirect).not.toHaveBeenCalled();
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    },
  );
});

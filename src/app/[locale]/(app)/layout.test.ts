import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import type { Session } from 'next-auth';

/**
 * The (app) layout is the first gate every /dashboard, /members and
 * /audit-log request passes through. Proves it turns away anonymous and
 * PENDING requests before any page-specific code (or data query) runs.
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
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { auth } = await import('@/lib/auth');
const { redirect } = await import('@/i18n/navigation');
const { default: AppLayout } = await import('./layout');

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

function callLayout() {
  return AppLayout({ children: null, params: Promise.resolve({ locale: 'fr' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('(app) layout — the shared gate for /dashboard, /members, /audit-log', () => {
  it('redirects anonymous visitors to the login page', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/' }));
  });

  it('redirects a PENDING user to the waiting page', async () => {
    mockAuth.mockResolvedValue(sessionFor('PENDING'));

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/pending' }));
  });

  it.each<Role>(['MEMBER', 'ADMIN', 'OWNER'])(
    'lets a %s user through to the app shell',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(callLayout()).resolves.toBeTruthy();

      expect(redirect).not.toHaveBeenCalled();
    },
  );
});

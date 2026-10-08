import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor, type AccountKind } from '@/test/session-fixtures';

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
vi.mock('@/lib/health', () => ({ isDatabaseReachable: vi.fn(async () => true) }));
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
const { isDatabaseReachable } = await import('@/lib/health');
const { default: AppLayout } = await import('./layout');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

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

  // With the database down Auth.js reports no session for everyone, signed in or not.
  it('shows the "service unavailable" page, not the login page, when the database is down', async () => {
    mockAuth.mockResolvedValue(null);
    vi.mocked(isDatabaseReachable).mockResolvedValueOnce(false);

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/unavailable' }));
  });

  it('redirects a PENDING user to the waiting page', async () => {
    mockAuth.mockResolvedValue(sessionFor('PENDING'));

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/pending' }));
  });

  it.each<AccountKind>(['MEMBER', 'ADMIN', 'OWNER'])(
    'lets a %s user through to the app shell',
    async (kind) => {
      mockAuth.mockResolvedValue(sessionFor(kind));

      await expect(callLayout()).resolves.toBeTruthy();

      expect(redirect).not.toHaveBeenCalled();
    },
  );
});

describe('(app) layout — the menu entry of the settings', () => {
  const navIds = async () => {
    const shell = (await callLayout()) as { props: { navItems: { id: string }[] } };
    return shell.props.navItems.map((item) => item.id);
  };

  it('is offered to an owner', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    expect(await navIds()).toContain('settings');
  });

  // An admin holds every permission, and still is not an owner: the settings decide who may do anything at all.
  it.each<AccountKind>(['ADMIN', 'MEMBER'])('is not offered to a %s', async (kind) => {
    mockAuth.mockResolvedValue(sessionFor(kind));
    expect(await navIds()).not.toContain('settings');
  });
});

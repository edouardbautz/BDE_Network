import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { renderToHtml } from '@/test/render-server';
import { sessionFor, type AccountKind } from '@/test/session-fixtures';

/**
 * Proves that hitting /audit-log directly is blocked for everyone except
 * OWNER, and that no log entry is ever fetched for a rejected request.
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
  prisma: { auditLog: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { auth } = await import('@/lib/auth');
const { redirect } = await import('@/i18n/navigation');
const { prisma } = await import('@/lib/prisma');
const { default: AuditLogPage } = await import('./page');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function callPage() {
  return AuditLogPage({ params: Promise.resolve({ locale: 'fr' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
});

describe('AuditLogPage — direct URL access control', () => {
  it.each<AccountKind>(['PENDING', 'MEMBER', 'ADMIN'])(
    'redirects a %s user to /dashboard without querying the audit log',
    async (kind) => {
      mockAuth.mockResolvedValue(sessionFor(kind));

      await expect(callPage()).rejects.toThrow(RedirectSignal);

      expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/dashboard' }));
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    },
  );

  it('redirects when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(callPage()).rejects.toThrow(RedirectSignal);

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('puts the table in a named box the keyboard can scroll', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: 'entry-1',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        actorLogin: 'alice',
        action: 'role.create',
        targetType: 'Role',
        targetLabel: 'Secretary',
      },
    ] as never);

    const page = document.createElement('div');
    page.innerHTML = await renderToHtml(await callPage());

    const region = page.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('title');
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(region?.querySelector('table')).not.toBeNull();
  });

  it('lets an OWNER through and loads the audit log', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));

    await expect(callPage()).resolves.toBeTruthy();

    expect(redirect).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});

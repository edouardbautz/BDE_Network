import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';

/**
 * After removing a member, an admin who has a BDE-wide calendar link active is
 * offered (not forced) to replace it, because a former member may have kept it.
 */

vi.mock('@/lib/auth/session', async () => {
  const { effectiveFor } = await import('@/test/session-fixtures');
  return { getEffectiveSession: vi.fn(async () => effectiveFor('ADMIN', 'admin', 'admin-1')) };
});
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/events/export', () => ({ getBdeFeedToken: vi.fn() }));
vi.mock('../events/shared-calendar/actions', () => ({ regenerateSharedCalendar: vi.fn() }));
vi.mock('./actions', () => ({
  approveMember: vi.fn(),
  rejectMember: vi.fn(),
  removeMember: vi.fn(),
  setModulePermission: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn(async () => []) },
    role: {
      findFirst: vi.fn(async () => ({ id: 'role-member' })),
      findMany: vi.fn(async () => []),
    },
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () =>
    Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      { has: () => true },
    ),
  ),
}));

const { getConfig } = await import('@/config');
const { getBdeFeedToken } = await import('@/lib/events/export');
const { default: MembersPage } = await import('./page');

function setup(options: { moduleEnabled: boolean; feedToken: string | null }) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: options.moduleEnabled ? ['events'] : [] },
  } as unknown as ReturnType<typeof getConfig>);
  vi.mocked(getBdeFeedToken).mockResolvedValue(options.feedToken);
}

const render = async (removed?: string | string[]) =>
  renderToHtml(
    <>
      {await MembersPage({
        params: Promise.resolve({ locale: 'fr' }),
        searchParams: Promise.resolve(removed === undefined ? {} : { removed }),
      })}
    </>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('members page — calendar link prompt after a removal', () => {
  it('proposes regenerating the BDE link, naming the member, when a link is active', async () => {
    setup({ moduleEnabled: true, feedToken: 'T'.repeat(43) });
    const html = await render('departed-user');

    expect(html).toContain('feedRemoval.title{&quot;member&quot;:&quot;departed-user&quot;}');
    expect(html).toContain('feedRemoval.description');
    expect(html).toContain('feedRemoval.regenerate');
    expect(html).toContain('feedRemoval.later');
  });

  it('never prints the token', async () => {
    setup({ moduleEnabled: true, feedToken: 'SECRET'.repeat(8) });
    expect(await render('departed-user')).not.toContain('SECRET');
  });

  it('shows nothing when no BDE link is active', async () => {
    setup({ moduleEnabled: true, feedToken: null });
    expect(await render('departed-user')).not.toContain('feedRemoval');
  });

  it('shows nothing when the events module is disabled, without looking for the link', async () => {
    setup({ moduleEnabled: false, feedToken: 'T'.repeat(43) });
    expect(await render('departed-user')).not.toContain('feedRemoval');
    expect(getBdeFeedToken).not.toHaveBeenCalled();
  });

  it('shows nothing on a normal visit', async () => {
    setup({ moduleEnabled: true, feedToken: 'T'.repeat(43) });
    expect(await render()).not.toContain('feedRemoval');
    expect(getBdeFeedToken).not.toHaveBeenCalled();
  });

  it.each(['<script>alert(1)</script>', 'a b', 'x'.repeat(65), ''])(
    'ignores a removed-member value that is not a plain login: %j',
    async (value) => {
      setup({ moduleEnabled: true, feedToken: 'T'.repeat(43) });
      const html = await render(value);
      expect(html).not.toContain('feedRemoval');
      expect(html).not.toContain('<script>alert');
    },
  );
});

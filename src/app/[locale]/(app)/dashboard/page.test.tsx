import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dashboard tells an OWNER when 42 refuses the platform's application, with the way to the settings. Nobody
 * else: a member cannot fix it, and must not even cause the check (it is a request to 42).
 */

const mocks = vi.hoisted(() => ({ session: vi.fn(), credentials: vi.fn() }));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth/require-session', () => ({ requireApprovedSession: mocks.session }));
vi.mock('@/lib/auth/oauth-check', () => ({ checkFortyTwoCredentials: mocks.credentials }));
vi.mock('@/config', () => ({
  getConfig: () => ({ modules: { enabled: [] }, bde: { timezone: 'Europe/Paris' } }),
}));
vi.mock('@/components/settings/oauth-rejected-alert', () => ({
  // an async Server Component cannot be rendered inside another by Testing Library: its own test is next to it
  OAuthRejectedAlert: ({ withLink }: { withLink?: boolean }) => (
    <div role="alert">{withLink ? 'rejected, with link' : 'rejected'}</div>
  ),
}));
vi.mock('@/lib/events/access', () => ({ getEventsAccess: async () => null }));
vi.mock('@/lib/events/categories', () => ({ getCategories: () => [] }));
vi.mock('@/lib/events/queries', () => ({ listUpcomingOccurrences: async () => [] }));
vi.mock('@/lib/account-label', () => ({ accountLabel: () => 'label' }));

const { default: DashboardPage } = await import('./page');

const user = (status: 'OWNER' | 'MEMBER') => ({
  user: {
    login: 'alice',
    name: 'Alice',
    campus: 'Nice',
    image: null,
    status,
    permissions: [],
    holdsAll: status === 'OWNER',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue('rejected');
});
afterEach(cleanup);

describe('DashboardPage, when 42 refuses the application', () => {
  it('tells an owner, with the way to the settings', async () => {
    mocks.session.mockResolvedValue(user('OWNER'));
    render(await DashboardPage());
    expect(screen.getByRole('alert')).toHaveTextContent('rejected, with link');
  });

  it('tells a member nothing, and does not even ask 42', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    render(await DashboardPage());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it('says nothing to an owner while 42 accepts it', async () => {
    mocks.credentials.mockResolvedValue('valid');
    mocks.session.mockResolvedValue(user('OWNER'));
    render(await DashboardPage());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

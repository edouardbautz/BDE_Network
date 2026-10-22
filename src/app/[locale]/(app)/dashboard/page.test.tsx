import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dashboard tells an OWNER when 42 refuses the platform's application, with the way to the settings. Nobody
 * else: a member cannot fix it, and must not even cause the check (it is a request to 42).
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  credentials: vi.fn(),
  updatesCheck: true,
  eventsAccess: vi.fn(),
  upcoming: vi.fn(),
  waiting: 0,
  validator: false,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  getLocale: async () => 'fr',
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth/require-session', () => ({ requireApprovedSession: mocks.session }));
vi.mock('@/lib/auth/oauth-check', () => ({ checkFortyTwoCredentials: mocks.credentials }));
vi.mock('@/config', () => ({
  getConfig: () => ({
    modules: { enabled: [] },
    bde: { timezone: 'Europe/Paris' },
    updates: { check: mocks.updatesCheck },
  }),
}));
vi.mock('@/components/updates/update-banner', () => ({
  // a client component that asks the network: its own test is next to it
  UpdateBanner: ({ enabled }: { enabled: boolean }) => (
    <div>update banner, enabled: {String(enabled)}</div>
  ),
}));
vi.mock('@/components/settings/oauth-rejected-alert', () => ({
  // an async Server Component cannot be rendered inside another by Testing Library: its own test is next to it
  OAuthRejectedAlert: ({ withLink }: { withLink?: boolean }) => (
    <div role="alert">{withLink ? 'rejected, with link' : 'rejected'}</div>
  ),
}));
vi.mock('@/lib/events/access', () => ({
  getEventsAccess: () => mocks.eventsAccess(),
  canValidateEvents: () => mocks.validator,
}));
vi.mock('@/lib/events/categories', () => ({ getCategories: () => [] }));
vi.mock('@/lib/events/queries', () => ({
  listUpcomingOccurrences: (...args: unknown[]) => mocks.upcoming(...args),
  countProposals: async () => mocks.waiting,
}));
// Async Server Components cannot be rendered inside another by Testing Library: each has its own test (or is a stand-in here).
vi.mock('@/components/dashboard/next-event-card', () => ({
  NextEventCard: ({ occurrence }: { occurrence: { title: string } }) => (
    <article>next event: {occurrence.title}</article>
  ),
}));
vi.mock('@/components/dashboard/upcoming-list', () => ({
  UpcomingList: ({ occurrences }: { occurrences: { title: string }[] }) => (
    <section>upcoming: {occurrences.map((o) => o.title).join(', ') || 'none'}</section>
  ),
}));
vi.mock('@/components/dashboard/account-card', () => ({
  AccountCard: ({ name, roleLabel }: { name: string; roleLabel: string }) => (
    <section>
      account: {name} / {roleLabel}
    </section>
  ),
}));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({
    eyebrow,
    title,
    actions,
  }: {
    eyebrow: string;
    title: string;
    actions?: ReactNode;
  }) => (
    <header>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
vi.mock('@/lib/account-label', () => ({ accountLabel: () => 'label' }));

const { default: DashboardPage } = await import('./page');

const user = (status: 'OWNER' | 'MEMBER') => ({
  user: {
    login: 'alice',
    name: 'Alice',
    campus: 'Nice',
    image: null,
    status,
    permissions: status === 'OWNER' ? [] : ['members.manage'],
    holdsAll: status === 'OWNER',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue('rejected');
  mocks.updatesCheck = true;
  mocks.eventsAccess.mockResolvedValue(null);
  mocks.upcoming.mockResolvedValue([]);
  mocks.waiting = 0;
  mocks.validator = false;
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

describe('DashboardPage, the notice of a new version', () => {
  it('is for an owner, who is told whether the check is on', async () => {
    mocks.session.mockResolvedValue(user('OWNER'));
    const { unmount } = render(await DashboardPage());
    expect(screen.getByText('update banner, enabled: true')).toBeInTheDocument();
    unmount();
    mocks.updatesCheck = false;
    render(await DashboardPage());
    expect(screen.getByText('update banner, enabled: false')).toBeInTheDocument();
  });

  it('is not for a member', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    render(await DashboardPage());
    expect(screen.queryByText(/update banner/)).toBeNull();
  });
});

const occurrence = (title: string, id: string) => ({
  key: id,
  eventId: id,
  title,
  start: new Date('2026-10-23T16:00:00Z'),
  end: new Date('2026-10-23T18:00:00Z'),
  originalStart: new Date('2026-10-23T16:00:00Z'),
  categoryKey: 'soiree',
  location: null,
  assignees: [],
});

describe('DashboardPage, its content', () => {
  it('greets by first name, above the date', async () => {
    mocks.session.mockResolvedValue({ user: { ...user('MEMBER').user, name: 'Alice Martin' } });
    render(await DashboardPage());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'greeting {"name":"Alice"}',
    );
  });

  it('fills the accent card with the next event and lists the others under it', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    mocks.eventsAccess.mockResolvedValue({ canCreate: true });
    mocks.upcoming.mockResolvedValue([
      occurrence('Soirée jeux', 'a'),
      occurrence('Tournoi', 'b'),
      occurrence('Repas', 'c'),
    ]);
    render(await DashboardPage());
    expect(screen.getByText('next event: Soirée jeux')).toBeInTheDocument();
    expect(screen.getByText('upcoming: Tournoi, Repas')).toBeInTheDocument();
  });

  it('has no accent card, and so no second accent, when nothing is coming', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    mocks.eventsAccess.mockResolvedValue({ canCreate: true });
    render(await DashboardPage());
    expect(screen.queryByText(/next event:/)).toBeNull();
    expect(screen.getByText('upcoming: none')).toBeInTheDocument();
  });

  it('puts the one main action in the header, for whoever may create an event', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    mocks.eventsAccess.mockResolvedValue({ canCreate: true });
    render(await DashboardPage());
    expect(screen.getByRole('link', { name: 'new' })).toHaveAttribute('href', '/events/new');
    cleanup();
    mocks.eventsAccess.mockResolvedValue({ canCreate: false });
    render(await DashboardPage());
    expect(screen.queryByRole('link', { name: 'new' })).toBeNull();
  });

  it('offers the shortcuts the person has the right to, and counts the proposals that wait', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    mocks.eventsAccess.mockResolvedValue({ canCreate: false });
    mocks.validator = true;
    mocks.waiting = 4;
    render(await DashboardPage());
    const shortcuts = screen.getByRole('region', { name: 'shortcuts.title' });
    expect(within(shortcuts).getByRole('link', { name: 'rail.events' })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(within(shortcuts).getByRole('link', { name: /rail.eventsReview/ })).toHaveTextContent(
      '4',
    );
    expect(within(shortcuts).getByRole('link', { name: 'rail.members' })).toBeInTheDocument();
    // not an owner: no settings
    expect(within(shortcuts).queryByRole('link', { name: 'rail.settings' })).toBeNull();
  });

  it('shows the account with the role it is held under', async () => {
    mocks.session.mockResolvedValue(user('MEMBER'));
    render(await DashboardPage());
    expect(screen.getByText('account: Alice / label')).toBeInTheDocument();
  });
});

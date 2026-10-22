import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/events' } }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppShell } = await import('./app-shell');

type Item = Parameters<typeof AppShell>[0]['navItems'][number];

const items: Item[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', shortLabel: 'Home' },
  { id: 'events', href: '/events', label: 'Events', shortLabel: 'Calendar' },
  {
    id: 'eventsReview',
    href: '/events/review',
    label: 'To validate',
    shortLabel: 'To validate',
    badge: 3,
    badgeLabel: '3 proposals to validate',
  },
];

function renderShell(
  navItems: Item[] = items,
  createActions: { href: string; label: string }[] = [],
  defaultLogo = true,
) {
  render(
    <AppShell
      bdeName="BDE Test"
      logoPath={defaultLogo ? '/logo.svg' : '/api/logo?v=0123456789abcdef'}
      defaultLogo={defaultLogo}
      navItems={navItems}
      createActions={createActions}
      userMenu={<button>rail account</button>}
      userMenuMobile={null}
      moreFooter={<p>account links</p>}
      footer={null}
      navLabel="Navigation"
      navDescription="Main links"
      moreLabel="More"
      createLabel="Create"
      skipLabel="Skip"
    >
      content
    </AppShell>,
  );
  // The rail and the tab bar are both in the page (the stylesheet shows one of them); the rail comes first.
  const [rail, tabBar] = screen.getAllByRole('navigation', { name: 'Navigation' });
  return Object.assign(within(rail!), { tabBar: within(tabBar!) });
}

beforeEach(() => {
  pathname.current = '/events';
});
afterEach(cleanup);

describe('the menu', () => {
  it('marks the page you are on', () => {
    pathname.current = '/dashboard';
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps a section marked on its sub-pages', () => {
    pathname.current = '/events/abc';
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks only the list to validate, not the Events entry it lives under', () => {
    pathname.current = '/events/review';
    const nav = renderShell();
    const current = nav.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(current.map((link) => link.getAttribute('href'))).toEqual(['/events/review']);
  });

  it('marks the Events entry again on another page of the module', () => {
    pathname.current = '/events/new';
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: /To validate/ }).getAttribute('aria-current')).toBeNull();
  });
});

describe('the counter of an entry', () => {
  it('shows how many proposals wait, and says it in words to a screen reader', () => {
    const nav = renderShell();
    const link = nav.getByRole('link', { name: /To validate/ });
    expect(within(link).getByText('3').getAttribute('aria-hidden')).toBe('true');
    expect(within(link).getByText('3 proposals to validate')).toBeTruthy();
    expect(link.textContent).toContain('To validate');
  });

  it.each([[0], [undefined]])('shows nothing when the counter is %s', (badge) => {
    const nav = renderShell(
      items.map((item) => (item.id === 'eventsReview' ? { ...item, badge } : item)),
    );
    const link = nav.getByRole('link', { name: 'To validate' });
    expect(link.querySelector('span[aria-hidden]')).toBeNull();
    expect(within(link).queryByText('3 proposals to validate')).toBeNull();
  });

  it('has no counter on an entry that does not ask for one', () => {
    const nav = renderShell();
    expect(
      nav.getByRole('link', { name: 'Calendar' }).querySelector('span[aria-hidden]'),
    ).toBeNull();
  });
});

describe('the rail', () => {
  it('prints a short word under every icon: an icon never stands alone', () => {
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Home' })).toHaveTextContent('Home');
    expect(nav.getByRole('link', { name: 'Calendar' })).toHaveTextContent('Calendar');
  });

  it('shows the initials of the BDE on the accent while it has not uploaded a logo, and its logo once it has', () => {
    renderShell(items, [], true);
    expect(screen.getByRole('link', { name: 'BDE Test' })).toHaveTextContent('BT');
    cleanup();
    renderShell(items, [], false);
    const logo = screen.getByRole('link', { name: 'BDE Test' });
    expect(logo.querySelector('img')).toHaveAttribute('src', '/api/logo?v=0123456789abcdef');
    expect(logo).not.toHaveTextContent('BT');
  });
});

describe('the tab bar of a phone', () => {
  it('keeps home and the calendar in view, the Create button between them and More, and puts the rest behind More', () => {
    const { tabBar } = renderShell(items, [{ href: '/events/new', label: 'New event' }]);
    const entries = tabBar.getAllByRole('link').map((link) => link.textContent?.trim());
    expect(entries).toEqual(['Home', 'Calendar']);
    expect(tabBar.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(tabBar.getByRole('button', { name: 'More' })).toBeTruthy();
    // the list to validate is not a tab: it is behind More
    expect(tabBar.queryByRole('link', { name: /To validate/ })).toBeNull();
  });

  it('has no Create button when there is nothing to create', () => {
    const { tabBar } = renderShell();
    expect(tabBar.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(tabBar.getByRole('button', { name: 'More' })).toBeTruthy();
  });

  it('opens More on the entries it holds, the counter of one, and the account links', async () => {
    const { tabBar } = renderShell();
    fireEvent.click(tabBar.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /To validate/ })).toHaveAttribute(
      'href',
      '/events/review',
    );
    expect(within(sheet).getByText('3 proposals to validate')).toBeTruthy();
    expect(within(sheet).getByText('account links')).toBeTruthy();
  });

  it('opens Create on what the person may start', async () => {
    const { tabBar } = renderShell(items, [{ href: '/events/new', label: 'New event' }]);
    fireEvent.click(tabBar.getByRole('button', { name: 'Create' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: 'New event' })).toHaveAttribute(
      'href',
      '/events/new',
    );
  });
});

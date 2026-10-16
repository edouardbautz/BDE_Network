import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
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
vi.mock('@/components/locale-switcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const { AppShell } = await import('./app-shell');

type Item = Parameters<typeof AppShell>[0]['navItems'][number];

const items: Item[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { id: 'events', href: '/events', label: 'Events' },
  {
    id: 'eventsReview',
    href: '/events/review',
    label: 'To validate',
    badge: 3,
    badgeLabel: '3 proposals to validate',
  },
];

function renderShell(navItems: Item[] = items) {
  render(
    <AppShell
      bdeName="BDE Test"
      logoPath="/logo.svg"
      navItems={navItems}
      userMenu={null}
      footer={null}
      menuLabel="Open menu"
      navLabel="Navigation"
      navDescription="Main links"
      skipLabel="Skip"
    >
      content
    </AppShell>,
  );
  // The desktop sidebar is always in the page; the phone's drawer is only drawn when it is open.
  return within(screen.getByRole('navigation', { name: 'Navigation' }));
}

beforeEach(() => {
  pathname.current = '/events';
});
afterEach(cleanup);

describe('the menu', () => {
  it('marks the page you are on', () => {
    pathname.current = '/dashboard';
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Events' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps a section marked on its sub-pages', () => {
    pathname.current = '/events/abc';
    const nav = renderShell();
    expect(nav.getByRole('link', { name: 'Events' }).getAttribute('aria-current')).toBe('page');
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
    expect(nav.getByRole('link', { name: 'Events' }).getAttribute('aria-current')).toBe('page');
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
    expect(nav.getByRole('link', { name: 'Events' }).querySelector('span[aria-hidden]')).toBeNull();
  });
});

import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The menu of the signed-in person (profile, sign out) is a Base UI menu, and Base UI throws when a menu label is not in a
 * group, which it does when the menu OPENS, not when the page is drawn: for as long as nothing opened it, every page of the
 * application passed its tests and every real person who clicked their name got the error page. This opens it.
 */

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
// The theme and language choices are client components with their own tests; here the menu is what is opened.
vi.mock('./account-preferences', () => ({
  AccountPreferenceGroups: () => null,
  PreferenceControls: () => null,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { UserMenu } = await import('./user-menu');

afterEach(cleanup);

const open = async () => {
  render(
    await UserMenu({
      name: 'Alice Martin',
      login: 'amartin',
      image: null,
      roleLabel: 'Admin',
      placement: 'rail',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: /Alice Martin/ }));
};

describe('UserMenu', () => {
  it('opens, with who is signed in, a link to the profile and the way to sign out', async () => {
    await open();

    // the button is named by text, not by an aria-label that leaves out the initials drawn on it (WCAG 2.5.3)
    expect(screen.getByRole('button', { name: /Alice Martin/ })).not.toHaveAttribute('aria-label');
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Alice Martin');
    expect(menu).toHaveTextContent('amartin');
    expect(menu).toHaveTextContent('Admin');
    expect(screen.getByRole('menuitem', { name: 'nav.profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('menuitem', { name: 'auth.logout' })).toHaveAttribute('type', 'submit');
  });

  it('keeps who is signed in as the label of a group of the menu', async () => {
    await open();

    const group = (await screen.findByRole('menu')).querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group).toHaveTextContent('amartin');
  });
});

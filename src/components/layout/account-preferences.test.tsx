import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Choosing a theme or a language in the account menu closes the menu. Base UI keeps a menu open after a radio item by default,
 * and the browsers did not agree on what that looked like: in Firefox the menu stayed over the page the person had just
 * changed, so the keyboard journey that chooses "Dark" never saw it close.
 */

const setTheme = vi.fn();
const replace = vi.fn();

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace }),
}));

const { AccountPreferenceGroups } = await import('./account-preferences');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Base UI ignores a click on an item in the first moments after the menu opened (the release of the click that opened it).
const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

const openMenu = () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <AccountPreferenceGroups />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
};

describe('the theme and language choices of the account menu', () => {
  it('closes the menu once a theme is chosen', async () => {
    openMenu();
    const dark = await screen.findByRole('menuitemradio', { name: 'theme.dark' });
    await settle();
    fireEvent.click(dark);

    expect(setTheme.mock.calls[0]?.[0]).toBe('dark');
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes the menu once a language is chosen, and keeps the page', async () => {
    openMenu();
    const french = await screen.findByRole('menuitemradio', { name: 'Français' });
    await settle();
    fireEvent.click(french);

    expect(replace).toHaveBeenCalledWith('/dashboard', { locale: 'fr' });
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});

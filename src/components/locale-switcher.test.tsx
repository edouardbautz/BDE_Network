import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/** The language switcher of the interface: both languages, each in itself, and the page is kept. */

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/members',
  useRouter: () => ({ replace: mocks.replace }),
}));

const { LocaleSwitcher } = await import('./locale-switcher');

const open = (locale: 'fr' | 'en') => {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
  const trigger = screen.getByRole('button', { name: locale === 'fr' ? 'Langue' : 'Language' });
  // A real click, as Base UI listens to it: press, release, click.
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseUp(trigger, { button: 0 });
  fireEvent.click(trigger, { button: 0 });
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/fr/members?year=2025-2026');
});
afterEach(cleanup);

describe('LocaleSwitcher', () => {
  it('names each language in itself, and marks the current one', async () => {
    open('fr');
    const french = await screen.findByRole('menuitem', { name: 'Français' });
    const english = screen.getByRole('menuitem', { name: 'English' });
    expect(french).toHaveAttribute('aria-current', 'true');
    expect(english).not.toHaveAttribute('aria-current');
    expect(english).toHaveAttribute('lang', 'en');
  });

  it('switches language and stays on the same page, query included', async () => {
    open('fr');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'English' }));
    expect(mocks.replace).toHaveBeenCalledWith('/members?year=2025-2026', { locale: 'en' });
  });

  it('does nothing for the language already in use', async () => {
    open('en');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'English' }));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

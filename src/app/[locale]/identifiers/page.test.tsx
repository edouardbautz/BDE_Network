import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../../messages/fr.json';

/**
 * The step of the first sign-in, with the real French messages: it asks the ids the session says are asked, sends an account that has nothing to
 * give where it belongs, and gives a way out.
 */

const mocks = vi.hoisted(() => ({ session: vi.fn(), redirect: vi.fn() }));

vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('@/components/locale-switcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('@/app/[locale]/(app)/profile/actions', () => ({ saveMentionIds: vi.fn() }));
vi.mock('@/config', () => ({
  getConfig: () => ({ bde: { name: 'BDE Test', logoPath: '/logo.svg' } }),
}));
vi.mock('@/i18n/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'fr', messages: fr, namespace } as never),
    getLocale: async () => 'fr',
  };
});

const { default: IdentifiersPage } = await import('./page');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const waiting = (over: Record<string, unknown> = {}) => ({
  user: { login: 'cmartin', name: 'Camille Martin', status: 'PENDING' },
  realStatus: 'PENDING',
  missingIds: ['discord', 'slack'],
  requiredIds: ['discord', 'slack'],
  ...over,
});

const open = async () =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {await IdentifiersPage({ params: Promise.resolve({ locale: 'fr' }) })}
    </NextIntlClientProvider>,
  );

describe('the step that asks the ids', () => {
  it('greets the person, says why, asks every platform the session says, and offers a way out', async () => {
    mocks.session.mockResolvedValue(waiting());
    await open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Un dernier détail, Camille',
    );
    expect(screen.getByText(/vous mentionner dans ses notifications/)).toBeInTheDocument();
    expect(screen.getByLabelText('Votre identifiant Discord')).toBeRequired();
    expect(screen.getByLabelText('Votre identifiant Slack')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    expect(screen.getByTestId('guide-discord')).toBeInTheDocument();
  });

  it('asks only the platforms that are asked', async () => {
    mocks.session.mockResolvedValue(waiting({ requiredIds: ['slack'], missingIds: ['slack'] }));
    await open();
    expect(screen.queryByLabelText('Votre identifiant Discord')).toBeNull();
    expect(screen.getByLabelText('Votre identifiant Slack')).toBeInTheDocument();
  });

  it('sends a visitor to the login page', async () => {
    mocks.session.mockResolvedValue(null);
    await open();
    expect(mocks.redirect).toHaveBeenCalledWith({ href: '/', locale: 'fr' });
  });

  it.each([
    [
      'an account with nothing to give that waits',
      waiting({ missingIds: [], requiredIds: [] }),
      '/pending',
    ],
    [
      'an approved account (it is asked in a window, over its page)',
      waiting({ realStatus: 'MEMBER' }),
      '/dashboard',
    ],
  ])('sends %s where it belongs', async (_label, session, href) => {
    mocks.session.mockResolvedValue(session);
    await open();
    expect(mocks.redirect).toHaveBeenCalledWith({ href, locale: 'fr' });
  });
});

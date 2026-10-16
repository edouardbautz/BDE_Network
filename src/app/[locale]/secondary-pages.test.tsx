import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';

/**
 * The pages that no scenario of the browser tests opens often: the waiting page, the privacy policy and the page
 * of a database that is down. They run here with the real French messages, so a key that went missing shows.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn(),
  contactEmail: undefined as string | undefined,
}));

vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('@/components/locale-switcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('@/components/layout/unavailable-retry', () => ({
  UnavailableRetry: () => <button type="button">retry</button>,
}));
vi.mock('@/config', () => ({
  getConfig: () => ({
    bde: { name: 'BDE Test', logoPath: '/logo.svg', contactEmail: mocks.contactEmail },
  }),
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: mocks.redirect,
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator: create } = await import('next-intl');
  const messages = (await import('../../../messages/fr.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      create({ locale: 'fr', messages, namespace } as never),
    getLocale: async () => 'fr',
  };
});

const { default: PendingPage } = await import('./pending/page');
const { default: PrivacyPage } = await import('./privacy/page');
const { default: UnavailablePage } = await import('./unavailable/page');

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactEmail = undefined;
});

const pendingSession = { user: { login: 'dupont', name: 'Marie Dupont', status: 'PENDING' } };
const tPending = createTranslator({ locale: 'fr', messages: fr, namespace: 'pending' });
const tPrivacy = createTranslator({ locale: 'fr', messages: fr, namespace: 'privacy' });

describe('the waiting page', () => {
  const open = async () => render(await PendingPage({ params: Promise.resolve({ locale: 'fr' }) }));

  it('tells somebody who waits for approval who they are signed in as, and lets them sign out', async () => {
    mocks.session.mockResolvedValue(pendingSession);
    await open();

    expect(screen.getByText(tPending('title'))).toBeInTheDocument();
    expect(
      screen.getByText(tPending('signedInAs', { name: 'Marie Dupont', login: 'dupont' })),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /déconnecter|logout|Se /i })).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('falls back on the login when the account has no name', async () => {
    mocks.session.mockResolvedValue({ user: { login: 'dupont', name: null, status: 'PENDING' } });
    await open();
    expect(
      screen.getByText(tPending('signedInAs', { name: 'dupont', login: 'dupont' })),
    ).toBeInTheDocument();
  });

  it('sends a visitor to the login page, and an approved member to the dashboard', async () => {
    mocks.session.mockResolvedValue(null);
    expect(await PendingPage({ params: Promise.resolve({ locale: 'fr' }) })).toBeNull();
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: '/', locale: 'fr' });

    mocks.session.mockResolvedValue({ user: { login: 'bob', status: 'MEMBER' } });
    expect(await PendingPage({ params: Promise.resolve({ locale: 'fr' }) })).toBeNull();
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: '/dashboard', locale: 'fr' });
    // an owner is not "pending" either
    mocks.session.mockResolvedValue({ user: { login: 'alice', status: 'OWNER' } });
    await PendingPage({ params: Promise.resolve({ locale: 'fr' }) });
    expect(mocks.redirect).toHaveBeenLastCalledWith({ href: '/dashboard', locale: 'fr' });
  });
});

describe('the privacy policy', () => {
  const open = async () => render(await PrivacyPage());
  const items = tPrivacy.raw('dataCollected.items') as string[];

  it('is public, names the BDE and lists every piece of data that is collected', async () => {
    mocks.session.mockResolvedValue(null);
    await open();

    expect(screen.getByRole('heading', { level: 1, name: tPrivacy('title') })).toBeInTheDocument();
    expect(screen.getByText(tPrivacy('intro', { bdeName: 'BDE Test' }))).toBeInTheDocument();
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) expect(screen.getByText(item)).toBeInTheDocument();
    // every section is there, with its title
    for (const section of [
      'dataCollected',
      'purpose',
      'notifications',
      'calendar',
      'retention',
      'rights',
      'cookies',
      'contact',
    ]) {
      expect(
        screen.getByRole('heading', { name: tPrivacy(`${section}.title` as never) }),
      ).toBeInTheDocument();
    }
  });

  it('offers the export of one’s data only to somebody who is signed in', async () => {
    mocks.session.mockResolvedValue(null);
    await open();
    expect(screen.queryByText(tPrivacy('export.button'))).toBeNull();

    cleanup();
    mocks.session.mockResolvedValue({ user: { login: 'bob', status: 'MEMBER' } });
    await open();
    const link = screen.getByText(tPrivacy('export.button')).closest('a');
    expect(link).toHaveAttribute('href', '/api/me/export');
    expect(link).toHaveAttribute('download');
  });

  it('gives the address to write to when the BDE has one, and says so otherwise', async () => {
    mocks.session.mockResolvedValue(null);
    mocks.contactEmail = 'bureau@bde.example.fr';
    await open();
    expect(screen.getByRole('link', { name: 'bureau@bde.example.fr' })).toHaveAttribute(
      'href',
      'mailto:bureau@bde.example.fr',
    );

    cleanup();
    mocks.contactEmail = undefined;
    await open();
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
    expect(
      screen.getByText(tPrivacy('contact.description', { bdeName: 'BDE Test' })),
    ).toBeInTheDocument();
  });

  it('writes an address as text, never as markup', async () => {
    mocks.session.mockResolvedValue(null);
    mocks.contactEmail = '"><img src=x onerror=alert(1)>@x.fr';
    const { container } = await open();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('the page of a database that is down', () => {
  it('says so with the retry button, and needs no data to do it', async () => {
    render(await UnavailablePage());
    const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'unavailable' });
    expect(screen.getByRole('heading', { name: t('title') })).toBeInTheDocument();
    expect(screen.getByText(t('description'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

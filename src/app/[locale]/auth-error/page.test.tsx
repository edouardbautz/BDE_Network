import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), credentials: vi.fn() }));

vi.mock('@/components/locale-switcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('@/lib/auth/oauth-check', () => ({ checkFortyTwoCredentials: mocks.credentials }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { default: AuthErrorPage } = await import('./page');

const renderPage = async (searchParams: Record<string, string>) =>
  render(
    await AuthErrorPage({
      params: Promise.resolve({ locale: 'fr' }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.credentials.mockResolvedValue('valid');
});

describe('AuthErrorPage', () => {
  it('says the application is refused when 42 refuses it, whichever way Auth.js reports it', async () => {
    mocks.credentials.mockResolvedValue('rejected');
    for (const error of ['OAuthCallbackError', 'Configuration']) {
      const { unmount } = await renderPage({ error });
      expect(screen.getByText('oauthRejected')).toBeInTheDocument();
      unmount();
    }
  });

  it('keeps "try again" for a visitor who simply cancelled on the intra', async () => {
    await renderPage({ error: 'OAuthCallbackError' });
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(mocks.credentials).toHaveBeenCalled();
  });

  it('tells a problem on the platform side from a plain failure', async () => {
    await renderPage({ error: 'Configuration' });
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('does not ask 42 for the errors that have nothing to do with the application', async () => {
    await renderPage({ error: 'AccessDenied' });
    expect(screen.getByText('AccessDenied')).toBeInTheDocument();
    await renderPage({ reason: 'missing-profile' });
    expect(screen.getByText('missingProfile')).toBeInTheDocument();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
});

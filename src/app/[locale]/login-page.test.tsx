import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The login page tells a visitor when 42 refuses the platform's application (expired or regenerated
 * secret): the operator's problem, which "try again" cannot fix, and which used to show only as a failure
 * after the round trip to 42.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reachable: vi.fn(),
  credentials: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ signIn: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('@/lib/health', () => ({ isDatabaseReachable: mocks.reachable }));
vi.mock('@/lib/auth/oauth-check', () => ({ checkFortyTwoCredentials: mocks.credentials }));
vi.mock('@/config', () => ({
  getConfig: () => ({ bde: { name: 'BDE Test', logoPath: '/logo.svg' } }),
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { default: LoginPage } = await import('./page');

const renderPage = async () =>
  render(await LoginPage({ params: Promise.resolve({ locale: 'fr' }) }));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.reachable.mockResolvedValue(true);
  mocks.credentials.mockResolvedValue('valid');
});

describe('LoginPage', () => {
  it('offers the sign-in button when 42 accepts the application', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'loginButton' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not warn when nothing is known about the application (42 slow or unreachable)', async () => {
    mocks.credentials.mockResolvedValue('unknown');
    await renderPage();
    expect(screen.getByRole('button', { name: 'loginButton' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what is wrong, and disables the button, when 42 refuses the application', async () => {
    mocks.credentials.mockResolvedValue('rejected');
    await renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('oauthRejected.title');
    expect(alert).toHaveTextContent('oauthRejected.description');
    expect(alert).toHaveTextContent('oauthRejected.operator');
    expect(screen.getByRole('button', { name: 'loginButton' })).toBeDisabled();
  });

  it('does not ask 42 when the database is down: the unavailable page comes first', async () => {
    mocks.reachable.mockResolvedValue(false);
    await renderPage();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
});

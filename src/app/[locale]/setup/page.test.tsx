import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The installer page: a 404 once installed, nothing but the code form without the code, the wizard with it. */

const mocks = vi.hoisted(() => {
  class NotFound extends Error {}
  return {
    NotFound,
    setup: true,
    session: vi.fn(),
    wizard: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new mocks.NotFound('NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/lib/setup/guard', () => ({ isSetupMode: () => mocks.setup }));
vi.mock('@/lib/setup/session', () => ({
  getSetupSession: mocks.session,
  requestOrigin: async () => 'http://localhost:3500',
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, locale, children }: { href: string; locale?: string; children?: ReactNode }) => (
    <a href={`/${locale ?? 'fr'}${href}`}>{children}</a>
  ),
}));
vi.mock('@/components/setup/code-form', () => ({ CodeForm: () => <div>code form</div> }));
vi.mock('@/components/setup/wizard', () => ({
  SetupWizard: (props: { initial: { addressUrl: string; name: string } }) => {
    mocks.wizard(props);
    return <div>wizard for {props.initial.name}</div>;
  },
}));

const { default: SetupPage, generateMetadata } = await import('./page');

const renderPage = async (locale = 'fr') =>
  render(await SetupPage({ params: Promise.resolve({ locale }) }));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setup = true;
  mocks.session.mockResolvedValue(null);
});

describe('SetupPage', () => {
  it('is a 404 once the platform is installed', async () => {
    mocks.setup = false;
    await expect(renderPage()).rejects.toThrow(mocks.NotFound);
  });

  it('shows only the code form, and none of the draft, without the code', async () => {
    await renderPage();
    expect(screen.getByText('code form')).toBeInTheDocument();
    expect(screen.queryByText(/wizard/)).toBeNull();
    expect(mocks.wizard).not.toHaveBeenCalled();
  });

  it('shows the wizard, with the answers so far and the address the browser used, with the code', async () => {
    mocks.session.mockResolvedValue({ key: 'k', draft: { step: 2, name: 'BDE Test' } });
    await renderPage();
    expect(screen.getByText('wizard for BDE Test')).toBeInTheDocument();
    expect(mocks.wizard.mock.calls[0]?.[0].initial).toMatchObject({
      step: 2,
      name: 'BDE Test',
      addressUrl: 'http://localhost:3500',
    });
    expect(screen.queryByText('code form')).toBeNull();
  });

  it('offers the other language', async () => {
    await renderPage('fr');
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/en/setup');
  });

  it('has its own title, which the search engines are told to ignore', async () => {
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'fr' }) })).toEqual({
      title: { absolute: 'title · BDE_Network' },
      robots: { index: false },
    });
  });
});

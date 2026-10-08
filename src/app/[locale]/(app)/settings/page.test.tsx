import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The settings page: owners only, the backup of the secrets volume always in view, read only while in files. */

const mocks = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  }
  return {
    Redirect,
    manager: vi.fn(),
    editable: vi.fn(),
    secretsStatus: 'ok' as 'ok' | 'resealed' | 'lost',
    installedAt: new Date('2026-10-01T10:00:00Z') as Date | null,
    panels: vi.fn(),
    credentials: vi.fn(),
  };
});

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    `${key}${values ? JSON.stringify(values) : ''}`,
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: ({ href }: { href: string }) => {
    throw new mocks.Redirect(href);
  },
}));
vi.mock('@/lib/auth/oauth-check', () => ({ checkFortyTwoCredentials: mocks.credentials }));
vi.mock('@/components/settings/oauth-rejected-alert', () => ({
  // an async Server Component cannot be rendered inside another by Testing Library: its own test is next to it
  OAuthRejectedAlert: ({ withLink }: { withLink?: boolean }) => (
    <div role="alert">{withLink ? 'rejected, with link' : 'rejected'}</div>
  ),
}));
vi.mock('@/lib/settings/access', () => ({
  getSettingsManager: mocks.manager,
  isSettingsEditable: mocks.editable,
}));
vi.mock('@/lib/settings/runtime', () => ({
  getRuntimeSettings: () => ({ secretsStatus: mocks.secretsStatus }),
}));
vi.mock('@/lib/settings/view', () => ({
  settingsView: () => ({ name: 'BDE Test', owners: ['alice'] }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformSettings: {
      findUnique: async () => (mocks.installedAt ? { installedAt: mocks.installedAt } : null),
    },
  },
}));
vi.mock('@/components/events/copy-field', () => ({
  CopyField: ({ value }: { value: string }) => <code data-testid="command">{value}</code>,
}));
vi.mock('@/components/settings/settings-panels', () => ({
  SettingsPanels: (props: { actorLogin: string; view: { name: string } }) => {
    mocks.panels(props);
    return <div>panels for {props.actorLogin}</div>;
  },
}));

const { default: SettingsPage } = await import('./page');

const renderPage = async () =>
  render(await SettingsPage({ params: Promise.resolve({ locale: 'fr' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ user: { login: 'alice' } });
  mocks.editable.mockReturnValue(true);
  mocks.credentials.mockResolvedValue('valid');
  mocks.secretsStatus = 'ok';
  mocks.installedAt = new Date('2026-10-01T10:00:00Z');
});
afterEach(cleanup);

describe('SettingsPage', () => {
  it('sends away anybody who is not an owner, before reading anything', async () => {
    mocks.manager.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(mocks.Redirect);
    expect(mocks.panels).not.toHaveBeenCalled();
  });

  it('shows the forms to an owner, who is told who they are', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(screen.getByText('panels for alice')).toBeInTheDocument();
    expect(mocks.panels.mock.calls[0]?.[0].view.name).toBe('BDE Test');
  });

  it('always reminds to back up the secrets volume, with the command', async () => {
    await renderPage();
    expect(screen.getByText('backup.title')).toBeInTheDocument();
    expect(screen.getByText('backup.body')).toBeInTheDocument();
    expect(screen.getByTestId('command')).toHaveTextContent('./scripts/backup.sh');
    expect(screen.getByText('backup.note')).toBeInTheDocument();
  });

  it('says since when the settings are in the database', async () => {
    await renderPage();
    expect(screen.getByText(/since/)).toBeInTheDocument();
  });

  it('is read only, and says why, while the settings are still in the files', async () => {
    mocks.editable.mockReturnValue(false);
    await renderPage();
    expect(screen.getByText('readOnly.title')).toBeInTheDocument();
    expect(screen.queryByText(/panels for/)).toBeNull();
    // the reminder stays: it concerns the platform, not this page
    expect(screen.getByText('backup.title')).toBeInTheDocument();
  });

  it.each([
    ['lost', 'secrets.lostTitle'],
    ['resealed', 'secrets.resealedTitle'],
  ] as const)('warns when the secrets were %s at start-up', async (status, title) => {
    mocks.secretsStatus = status;
    await renderPage();
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('tells the owner when 42 refuses the application, without a link to the page they are on', async () => {
    mocks.credentials.mockResolvedValue('rejected');
    await renderPage();
    expect(screen.getByText('rejected')).toBeInTheDocument();
  });

  it.each(['valid', 'unknown'] as const)('says nothing about 42 when it is %s', async (status) => {
    mocks.credentials.mockResolvedValue(status);
    await renderPage();
    expect(screen.queryByText('rejected')).toBeNull();
  });

  it('does not warn when the secrets opened', async () => {
    await renderPage();
    expect(screen.queryByText('secrets.lostTitle')).toBeNull();
    expect(screen.queryByText('secrets.resealedTitle')).toBeNull();
  });
});

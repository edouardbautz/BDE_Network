import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The settings page: owners only, the backups always in view, read only while in files. */

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
    updatesCheck: true,
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
vi.mock('@/config', () => ({
  getConfig: () => ({ updates: { check: mocks.updatesCheck }, bde: { timezone: 'Europe/Paris' } }),
}));
vi.mock('@/lib/backups/list', () => ({
  readOverview: async (dir: string) => ({ dir, backups: [] }),
}));
vi.mock('@/lib/backups/service', () => ({ backupDir: () => '/auto-backups' }));
vi.mock('@/components/settings/backups-section', () => ({
  // an async Server Component with a client dialog inside: its own test is next to it
  BackupsSection: (props: { notice: string | null; timeZone: string; locale: string }) => (
    <div>
      backups, notice: {props.notice ?? 'none'}, {props.timeZone}, {props.locale}
    </div>
  ),
}));
vi.mock('@/components/updates/update-banner', () => ({
  // a client component that asks the network: its own test is next to it
  UpdateBanner: ({ enabled }: { enabled: boolean }) => (
    <div>update banner, enabled: {String(enabled)}</div>
  ),
}));
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
  settingsExtras: async () => ({
    logo: { path: '/logo.svg', custom: false },
    updates: { check: true },
    events: null,
  }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformSettings: {
      findUnique: async () => (mocks.installedAt ? { installedAt: mocks.installedAt } : null),
    },
  },
}));
vi.mock('@/components/settings/settings-panels', () => ({
  SettingsPanels: (props: { actorLogin: string; view: { name: string }; extras: unknown }) => {
    mocks.panels(props);
    return <div>panels for {props.actorLogin}</div>;
  },
}));

const { default: SettingsPage } = await import('./page');

const renderPage = async (search: { backup?: string | string[] } = {}) =>
  render(
    await SettingsPage({
      params: Promise.resolve({ locale: 'fr' }),
      searchParams: Promise.resolve(search),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ user: { login: 'alice' } });
  mocks.editable.mockReturnValue(true);
  mocks.credentials.mockResolvedValue('valid');
  mocks.secretsStatus = 'ok';
  mocks.updatesCheck = true;
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
    expect(mocks.panels.mock.calls[0]?.[0].extras).toEqual({
      logo: { path: '/logo.svg', custom: false },
      updates: { check: true },
      events: null,
    });
  });

  it('shows the notice of a new version, with the setting that turns it off', async () => {
    await renderPage();
    expect(screen.getByText('update banner, enabled: true')).toBeInTheDocument();
    cleanup();
    mocks.updatesCheck = false;
    await renderPage();
    expect(screen.getByText('update banner, enabled: false')).toBeInTheDocument();
  });

  it('always shows the backups, in the time zone of the BDE', async () => {
    await renderPage();
    expect(screen.getByText('backups, notice: none, Europe/Paris, fr')).toBeInTheDocument();
  });

  it.each(['made', 'busy', 'dump'])(
    'says what the backup that was just asked came to (%s)',
    async (backup) => {
      await renderPage({ backup });
      expect(screen.getByText(`backups, notice: ${backup}, Europe/Paris, fr`)).toBeInTheDocument();
    },
  );

  it.each(['<script>alert(1)</script>', 'nothing', ''])(
    'ignores a notice that is not in the list, and never echoes it (%j)',
    async (backup) => {
      await renderPage({ backup });
      expect(screen.getByText('backups, notice: none, Europe/Paris, fr')).toBeInTheDocument();
    },
  );

  it('says since when the settings are in the database', async () => {
    await renderPage();
    expect(screen.getByText(/since/)).toBeInTheDocument();
  });

  it('is read only, and says why, while the settings are still in the files', async () => {
    mocks.editable.mockReturnValue(false);
    await renderPage();
    expect(screen.getByText('readOnly.title')).toBeInTheDocument();
    expect(screen.queryByText(/panels for/)).toBeNull();
    // the backups stay: they concern the platform, not the settings that are in the files
    expect(screen.getByText(/^backups, notice/)).toBeInTheDocument();
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

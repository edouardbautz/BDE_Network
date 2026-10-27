import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../../messages/fr.json';
import type { BackupSituation } from './facts';

/** Telling the owners that the backups do not work: who, on which channels, in which words, and never a throw. */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/notifications/deliver', () => ({
  deliver: vi.fn(async () => ({ sent: 1, failed: 0 })),
}));
vi.mock('@/lib/notifications/recipients', () => ({
  emailsOfOwners: vi.fn(async () => ['alice@x.fr', 'bob@x.fr']),
}));
vi.mock('@/lib/notifications/templates/resolve', () => ({
  templatesFor: vi.fn(async () => ({
    build: (_channel: string, make: (context: object) => unknown) => make({}),
  })),
}));
vi.mock('@/lib/notifications/sender', () => ({
  discordSender: vi.fn(async () => ({ username: 'BDE Test' })),
  resolveLogoUrl: vi.fn(async () => undefined),
}));
vi.mock('@/lib/public-address', () => ({
  registeredAddress: vi.fn(() => 'https://bde.example.fr'),
}));
vi.mock('@/lib/notifications/translate', () => ({
  /** The real French catalog, so a missing message fails the test. */
  getNotificationTranslate: vi.fn(async (_locale: string, namespace: string) => {
    const messages = (await import('../../../../messages/fr.json')).default as Record<
      string,
      unknown
    >;
    const node = namespace
      .split('.')
      .reduce<unknown>((n, part) => (n as Record<string, unknown>)[part], messages);
    return (key: string, values: Record<string, string | number> = {}) => {
      const text = key
        .split('.')
        .reduce<unknown>((n, part) => (n as Record<string, unknown>)?.[part], node);
      if (typeof text !== 'string') throw new Error(`missing message ${namespace}.${key}`);
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    };
  }),
}));

const { getConfig } = await import('@/config');
const { deliver } = await import('@/lib/notifications/deliver');
const { notifyBackups } = await import('./send');

const SITUATION: BackupSituation = {
  reasonCode: 'space',
  lastAt: new Date('2026-10-25T02:00:04Z'),
  lastBytes: 108_107,
  days: 2,
};

function useChannels(channels: Record<string, string | string[]>) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', defaultLocale: 'fr', timezone: 'Europe/Paris' },
    notifications: notificationsConfig({ backupFailed: 'none', backupStale: 'none', ...channels }),
  } as unknown as ReturnType<typeof getConfig>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a backup that failed', () => {
  it('goes to every owner by e-mail, with the reason and the page where the backups are', async () => {
    useChannels({ backupFailed: ['email', 'discord'] });
    await notifyBackups('backupFailed', SITUATION);

    expect(deliver).toHaveBeenCalledTimes(1);
    const [type, message, recipients] = vi.mocked(deliver).mock.calls[0]!;
    expect(type).toBe('backupFailed');
    expect(recipients).toEqual(['alice@x.fr', 'bob@x.fr']);
    expect(message.subject).toBe('BDE Test : la sauvegarde automatique a échoué');
    expect(message.body).toContain('Il n’y a pas assez de place sur le disque des sauvegardes.');
    expect(message.body).toContain('https://bde.example.fr/fr/settings');
    // a card and a designed e-mail are there for the channels that were chosen
    expect(message.discord?.embeds?.[0]?.title).toContain('Sauvegarde échouée');
    expect(message.email?.html).toContain('Sauvegarde échouée');
  });

  it('sends nothing when no channel was chosen for it (the default)', async () => {
    useChannels({});
    await notifyBackups('backupFailed', SITUATION);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('is told on the channels of its own type, not of the other', async () => {
    useChannels({ backupStale: 'slack' });
    await notifyBackups('backupFailed', SITUATION);
    expect(deliver).not.toHaveBeenCalled();
    await notifyBackups('backupStale', { ...SITUATION, days: 3 });
    expect(vi.mocked(deliver).mock.calls[0]?.[0]).toBe('backupStale');
    expect(vi.mocked(deliver).mock.calls[0]?.[1].subject).toBe(
      'BDE Test : aucune sauvegarde depuis 3 jours',
    );
  });
});

describe('without the address of the platform', () => {
  it('says the same without a link', async () => {
    const { registeredAddress } = await import('@/lib/public-address');
    vi.mocked(registeredAddress).mockReturnValueOnce(null);
    useChannels({ backupStale: 'email' });
    await notifyBackups('backupStale', {
      reasonCode: null,
      lastAt: null,
      lastBytes: null,
      days: 4,
    });
    const message = vi.mocked(deliver).mock.calls[0]?.[1];
    expect(message?.body).toContain('aucune');
    expect(message?.body).not.toContain('http');
  });
});

describe('when something goes wrong', () => {
  it('never throws: a notification must not break the backup loop', async () => {
    useChannels({ backupFailed: 'discord' });
    vi.mocked(deliver).mockRejectedValueOnce(new Error('webhook down'));
    await expect(notifyBackups('backupFailed', SITUATION)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('has a word for every kind of failure in the catalog the page and the messages share', () => {
    expect(Object.keys(fr.settings.backups.reasons).length).toBeGreaterThanOrEqual(9);
  });
});

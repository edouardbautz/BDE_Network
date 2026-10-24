import { notificationsConfig } from '@/test/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./index', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));
vi.mock('@/lib/settings/runtime', () => ({ setting: vi.fn() }));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('./index');
const { setting: getSettingForRooms } = await import('@/lib/settings/runtime');
const { deliver } = await import('./deliver');

type Channel = 'email' | 'discord' | 'slack';

function useChannels(channels: Channel[], event = 'memberPending') {
  vi.mocked(getConfig).mockReturnValue({
    notifications: notificationsConfig({ [event]: channels }),
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(notify).mockResolvedValue(undefined);
  vi.mocked(notifyMany).mockImplementation(async (_channel, messages) =>
    messages.map(() => ({ ok: true as const })),
  );
});

describe('deliver', () => {
  it('sends nothing when no channel is ticked for the notification', async () => {
    useChannels([]);

    await expect(deliver('memberPending', message, ['a@x.fr'], '[t]')).resolves.toEqual({
      sent: 0,
      failed: 0,
      channels: {},
    });
    expect(notify).not.toHaveBeenCalled();
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it.each(['discord', 'slack'] as const)(
    'posts once to the %s channel, whatever the recipients',
    async (channel) => {
      useChannels([channel]);

      const result = await deliver('memberPending', message, ['a@x.fr', 'b@x.fr'], '[t]');

      expect(result).toEqual({
        sent: 1,
        failed: 0,
        channels: { [channel]: { sent: 1, failed: 0 } },
      });
      expect(notify).toHaveBeenCalledExactlyOnceWith(channel, message);
    },
  );

  it.each(['discord', 'slack'] as const)(
    'a failing %s webhook is logged with the caller prefix, not thrown',
    async (channel) => {
      useChannels([channel]);
      vi.mocked(notify).mockRejectedValue(new Error('webhook responded with 500'));

      await expect(deliver('memberPending', message, [], '[members]')).resolves.toMatchObject({
        sent: 0,
        failed: 1,
      });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`[members] memberPending: ${channel}`),
        expect.any(Error),
      );
    },
  );

  it('sends all the emails in one batch and keeps going when one fails', async () => {
    useChannels(['email']);
    vi.mocked(notifyMany).mockResolvedValue([
      { ok: true },
      { ok: false, error: new Error('550 mailbox unavailable') },
      { ok: true },
    ]);

    const result = await deliver('memberPending', message, ['a@x.fr', 'bad@x.fr', 'c@x.fr'], '[t]');

    expect(result).toMatchObject({
      sent: 2,
      failed: 1,
      channels: { email: { sent: 2, failed: 1 } },
    });
    expect(notifyMany).toHaveBeenCalledExactlyOnceWith('email', [
      { ...message, to: 'a@x.fr' },
      { ...message, to: 'bad@x.fr' },
      { ...message, to: 'c@x.fr' },
    ]);
    expect(notify).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[t] memberPending: email to a recipient failed'),
      expect.any(Error),
    );
  });

  it('reports nothing sent when there is no recipient', async () => {
    useChannels(['email']);
    vi.mocked(notifyMany).mockResolvedValue([]);

    await expect(deliver('memberPending', message, [], '[t]')).resolves.toMatchObject({
      sent: 0,
      failed: 0,
    });
  });

  it('never throws, even when the configuration itself cannot be read', async () => {
    vi.mocked(getConfig).mockImplementation(() => {
      throw new Error('no config');
    });

    await expect(deliver('memberPending', message, ['a@x.fr'], '[t]')).resolves.toEqual({
      sent: 0,
      failed: 0,
      channels: {},
    });
    expect(console.error).toHaveBeenCalled();
  });

  describe('several channels at once', () => {
    it('sends on every channel ticked: the team channels once, the e-mails to each recipient', async () => {
      useChannels(['discord', 'slack', 'email']);

      const result = await deliver('memberPending', message, ['a@x.fr', 'b@x.fr'], '[t]');

      expect(result).toEqual({
        sent: 4,
        failed: 0,
        channels: {
          discord: { sent: 1, failed: 0 },
          slack: { sent: 1, failed: 0 },
          email: { sent: 2, failed: 0 },
        },
      });
      expect(
        vi
          .mocked(notify)
          .mock.calls.map(([channel]) => channel)
          .sort(),
      ).toEqual(['discord', 'slack']);
      expect(notifyMany).toHaveBeenCalledExactlyOnceWith('email', [
        { ...message, to: 'a@x.fr' },
        { ...message, to: 'b@x.fr' },
      ]);
    });

    it('a channel that fails does not stop the others, nor cancel what already went', async () => {
      useChannels(['discord', 'slack', 'email']);
      vi.mocked(notify).mockImplementation(async (channel) => {
        if (channel === 'discord') throw new Error('webhook responded with 500');
      });

      const result = await deliver('memberPending', message, ['a@x.fr'], '[t]');

      expect(result.channels).toEqual({
        discord: { sent: 0, failed: 1 },
        slack: { sent: 1, failed: 0 },
        email: { sent: 1, failed: 0 },
      });
      expect(notify).toHaveBeenCalledWith('slack', message);
      expect(notifyMany).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it('does not throw when every channel fails, and says so for each', async () => {
      useChannels(['discord', 'slack', 'email']);
      vi.mocked(notify).mockRejectedValue(new Error('down'));
      vi.mocked(notifyMany).mockRejectedValue(new Error('SMTP down'));

      await expect(deliver('memberPending', message, ['a@x.fr'], '[t]')).resolves.toEqual({
        sent: 0,
        failed: 3,
        channels: {
          discord: { sent: 0, failed: 1 },
          slack: { sent: 0, failed: 1 },
          email: { sent: 0, failed: 1 },
        },
      });
    });

    it('sends on the channels at the same time: one that is slow does not hold the others back', async () => {
      useChannels(['discord', 'slack']);
      let releaseDiscord: () => void = () => undefined;
      vi.mocked(notify).mockImplementation((channel) =>
        channel === 'discord'
          ? new Promise<void>((resolve) => {
              releaseDiscord = resolve;
            })
          : Promise.resolve(),
      );

      const delivery = deliver('memberPending', message, [], '[t]');
      // Discord has not answered, and Slack has already been asked.
      await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('slack', message));
      expect(notify).toHaveBeenCalledWith('discord', message);
      releaseDiscord();
      await expect(delivery).resolves.toMatchObject({ sent: 2, failed: 0 });
    });

    it('never writes by e-mail to a member who was removed, whatever the configuration lists', async () => {
      useChannels(['discord', 'email'], 'memberRemoved');

      const result = await deliver('memberRemoved', message, ['gone@x.fr'], '[t]');

      expect(result.channels).toEqual({ discord: { sent: 1, failed: 0 } });
      expect(notifyMany).not.toHaveBeenCalled();
    });
  });
});

describe('the room a chat message goes to', () => {
  const STAFF_DISCORD = 'https://discord.com/api/webhooks/2/staff';

  beforeEach(() => {
    vi.mocked(getSettingForRooms).mockImplementation((key: string) =>
      key === 'DISCORD_STAFF_WEBHOOK_URL' ? STAFF_DISCORD : undefined,
    );
  });

  it('is the BDE room by default: the adapter reads the webhook of the settings', async () => {
    useChannels(['discord']);
    await deliver('memberPending', message, [], '[t]');
    expect(notify).toHaveBeenCalledWith('discord', message);
  });

  it('is the staff room, when it has a webhook of its own, for what is written to the staff', async () => {
    useChannels(['discord']);
    await deliver('memberPending', message, [], '[t]', 'staff');
    expect(notify).toHaveBeenCalledWith('discord', message, { webhookUrl: STAFF_DISCORD });
  });

  it('falls back on the BDE room for a channel the staff has no webhook for', async () => {
    useChannels(['slack']);
    await deliver('memberPending', message, [], '[t]', 'staff');
    expect(notify).toHaveBeenCalledWith('slack', message);
  });

  it('does not change who the e-mails go to: the recipients are the caller’s, whatever the room', async () => {
    useChannels(['email']);
    await deliver('memberPending', message, ['a@x.fr'], '[t]', 'staff');
    expect(notifyMany).toHaveBeenCalledWith('email', [{ ...message, to: 'a@x.fr' }]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./index', () => ({ notify: vi.fn(), notifyMany: vi.fn() }));

const { getConfig } = await import('@/config');
const { notify, notifyMany } = await import('./index');
const { deliver } = await import('./deliver');

type Channel = 'email' | 'discord' | 'slack' | 'none';

function useChannel(channel: Channel) {
  vi.mocked(getConfig).mockReturnValue({
    notifications: { memberPending: channel },
  } as unknown as ReturnType<typeof getConfig>);
}

const message = { subject: 'Sujet', body: 'Corps' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('deliver', () => {
  it('sends nothing on the "none" channel', async () => {
    useChannel('none');

    await expect(deliver('memberPending', message, ['a@x.fr'], '[t]')).resolves.toEqual({
      sent: 0,
      failed: 0,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(['discord', 'slack'] as const)(
    'posts once to the %s channel, whatever the recipients',
    async (channel) => {
      useChannel(channel);

      const result = await deliver('memberPending', message, ['a@x.fr', 'b@x.fr'], '[t]');

      expect(result).toEqual({ sent: 1, failed: 0 });
      expect(notify).toHaveBeenCalledExactlyOnceWith('memberPending', message);
    },
  );

  it.each(['discord', 'slack'] as const)(
    'a failing %s webhook is logged with the caller prefix, not thrown',
    async (channel) => {
      useChannel(channel);
      vi.mocked(notify).mockRejectedValue(new Error('webhook responded with 500'));

      await expect(deliver('memberPending', message, [], '[members]')).resolves.toEqual({
        sent: 0,
        failed: 1,
      });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[members] memberPending'),
        expect.any(Error),
      );
    },
  );

  it('sends all the emails in one batch and keeps going when one fails', async () => {
    useChannel('email');
    vi.mocked(notifyMany).mockResolvedValue([
      { ok: true },
      { ok: false, error: new Error('550 mailbox unavailable') },
      { ok: true },
    ]);

    const result = await deliver('memberPending', message, ['a@x.fr', 'bad@x.fr', 'c@x.fr'], '[t]');

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(notifyMany).toHaveBeenCalledExactlyOnceWith('memberPending', [
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
    useChannel('email');
    vi.mocked(notifyMany).mockResolvedValue([]);

    await expect(deliver('memberPending', message, [], '[t]')).resolves.toEqual({
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
    });
    expect(console.error).toHaveBeenCalled();
  });
});

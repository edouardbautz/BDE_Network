import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));

const { getConfig } = await import('@/config');
const { notifyMany } = await import('./index');

const fetchMock = vi.fn();

function useChannel(channel: 'discord' | 'none') {
  vi.mocked(getConfig).mockReturnValue({
    notifications: { memberPending: channel },
  } as unknown as ReturnType<typeof getConfig>);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.example/api/webhooks/1/abc');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('notifyMany, for an adapter that cannot share a connection', () => {
  it('sends the messages one after the other and reports each outcome, whatever happens to the others', async () => {
    useChannel('discord');
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const outcomes = await notifyMany('memberPending', [
      { subject: 'a', body: '1' },
      { subject: 'b', body: '2' },
      { subject: 'c', body: '3' },
    ]);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does nothing for the "none" channel, and reports success for each message', async () => {
    useChannel('none');

    await expect(notifyMany('memberPending', [{ subject: 'a', body: '1' }])).resolves.toEqual([
      { ok: true },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

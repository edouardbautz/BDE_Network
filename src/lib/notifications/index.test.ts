import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notify, notifyMany } = await import('./index');

const fetchMock = vi.fn();

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
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const outcomes = await notifyMany('discord', [
      { subject: 'a', body: '1' },
      { subject: 'b', body: '2' },
      { subject: 'c', body: '3' },
    ]);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('notify', () => {
  it('posts through the channel it is given, and throws when the channel refuses', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(notify('discord', { subject: 'a', body: '1' })).rejects.toThrow('404');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('discord.example');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// One fake adapter per channel, so what is chosen is what is asserted.
const sent = vi.hoisted(() => ({
  calls: [] as { channel: string; messages: unknown[] }[],
  failFor: new Set<string>(),
}));
const sendManyOf = vi.hoisted(() => ({ discord: false, slack: false, email: true }));

vi.mock('./adapters/email', () => ({
  EmailAdapter: class {
    async send(message: unknown) {
      sent.calls.push({ channel: 'email', messages: [message] });
    }
    async sendMany(messages: unknown[]) {
      sent.calls.push({ channel: 'email', messages });
      return messages.map(() => ({ ok: true as const }));
    }
  },
}));
vi.mock('./adapters/discord', () => ({
  DiscordAdapter: class {
    async send(message: { subject: string }) {
      if (sent.failFor.has(message.subject)) throw new Error(`discord refused ${message.subject}`);
      sent.calls.push({ channel: 'discord', messages: [message] });
    }
    sendMany = sendManyOf.discord ? async () => [] : undefined;
  },
}));
vi.mock('./adapters/slack', () => ({
  SlackAdapter: class {
    async send(message: unknown) {
      sent.calls.push({ channel: 'slack', messages: [message] });
    }
  },
}));

const { notify, notifyMany } = await import('./index');

const message = (subject: string) => ({ subject, body: 'b' });

beforeEach(() => {
  sent.calls = [];
  sent.failFor.clear();
});

describe('notify', () => {
  it.each(['email', 'discord', 'slack'] as const)(
    'sends through the channel it is given: %s',
    async (channel) => {
      await notify(channel, message('x'));
      expect(sent.calls.map((call) => call.channel)).toEqual([channel]);
    },
  );

  it('lets a failure of the adapter come out: the callers decide what to do with it', async () => {
    sent.failFor.add('boom');
    await expect(notify('discord', message('boom'))).rejects.toThrow('discord refused boom');
  });
});

describe('notifyMany', () => {
  it('hands every message to an adapter that can share one connection', async () => {
    const outcomes = await notifyMany('email', [message('1'), message('2'), message('3')]);
    expect(outcomes).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // one call with the three messages, not three calls
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.messages).toHaveLength(3);
  });

  it('sends one after the other through an adapter that cannot, and says what became of each', async () => {
    sent.failFor.add('2');
    const outcomes = await notifyMany('discord', [message('1'), message('2'), message('3')]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(outcomes[1]).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: 'discord refused 2' }),
    });
    // a failure does not stop the others
    expect(sent.calls.map((call) => (call.messages[0] as { subject: string }).subject)).toEqual([
      '1',
      '3',
    ]);
  });

  it('does nothing for no message', async () => {
    expect(await notifyMany('slack', [])).toEqual([]);
    expect(sent.calls).toEqual([]);
  });
});

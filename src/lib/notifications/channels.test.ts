import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ channels: {} as Record<string, string> }));
vi.mock('@/config', () => ({ getConfig: () => ({ notifications: config.channels }) }));

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
vi.mock('./adapters/none', () => ({
  NoneAdapter: class {
    async send(message: unknown) {
      sent.calls.push({ channel: 'none', messages: [message] });
    }
  },
}));

const { notify, notifyMany } = await import('./index');

const message = (subject: string) => ({ subject, body: 'b' });

beforeEach(() => {
  sent.calls = [];
  sent.failFor.clear();
  config.channels = {};
});

describe('notify', () => {
  it.each(['email', 'discord', 'slack', 'none'])(
    'sends through the channel configured for the event: %s',
    async (channel) => {
      config.channels = { eventConfirmed: channel };
      await notify('eventConfirmed' as never, message('x') as never);
      expect(sent.calls.map((call) => call.channel)).toEqual([channel]);
    },
  );

  it('sends nothing anywhere for a channel it does not know, and for an event with none', async () => {
    config.channels = { eventConfirmed: 'carrier-pigeon' };
    await notify('eventConfirmed' as never, message('x') as never);
    await notify('eventReminder' as never, message('y') as never);
    // both go to the adapter that does nothing
    expect(sent.calls.map((call) => call.channel)).toEqual(['none', 'none']);
  });

  it('uses the channel of each event on its own', async () => {
    config.channels = { eventConfirmed: 'discord', eventReminder: 'slack' };
    await notify('eventConfirmed' as never, message('a') as never);
    await notify('eventReminder' as never, message('b') as never);
    expect(sent.calls.map((call) => call.channel)).toEqual(['discord', 'slack']);
  });

  it('lets a failure of the adapter come out: the callers decide what to do with it', async () => {
    config.channels = { eventConfirmed: 'discord' };
    sent.failFor.add('boom');
    await expect(notify('eventConfirmed' as never, message('boom') as never)).rejects.toThrow(
      'discord refused boom',
    );
  });
});

describe('notifyMany', () => {
  it('hands every message to an adapter that can share one connection', async () => {
    config.channels = { eventConfirmed: 'email' };
    const outcomes = await notifyMany(
      'eventConfirmed' as never,
      [message('1'), message('2'), message('3')] as never,
    );
    expect(outcomes).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // one call with the three messages, not three calls
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.messages).toHaveLength(3);
  });

  it('sends one after the other through an adapter that cannot, and says what became of each', async () => {
    config.channels = { eventConfirmed: 'discord' };
    sent.failFor.add('2');
    const outcomes = await notifyMany(
      'eventConfirmed' as never,
      [message('1'), message('2'), message('3')] as never,
    );
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
    config.channels = { eventConfirmed: 'slack' };
    expect(await notifyMany('eventConfirmed' as never, [])).toEqual([]);
    expect(sent.calls).toEqual([]);
  });
});

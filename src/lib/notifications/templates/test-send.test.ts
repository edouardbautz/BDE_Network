// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { directoryKey, type MentionDirectory } from './mentions';
import type { NotificationMessage } from '../types';

/**
 * The test message of a template: it uses what is on the screen (saved or not), says it is a test, is sent through the channel's real
 * adapter, never notifies anybody unless asked to, and cannot be used to flood a channel.
 */

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  settings: {} as Record<string, string | undefined>,
  directory: {} as MentionDirectory,
  audience: vi.fn(),
}));

vi.mock('..', () => ({ notify: mocks.notify }));
vi.mock('@/lib/events/intra-audience', () => ({ staffAudience: mocks.audience }));
vi.mock('@/config', () => ({
  getConfig: () => ({
    bde: {
      name: 'BDE Nice',
      defaultLocale: 'fr',
      timezone: 'Europe/Paris',
      accentColor: '#2F5BEA',
      logoPath: '/logo.svg',
    },
  }),
}));
vi.mock('@/lib/public-address', () => ({ registeredAddress: () => 'https://bde.example.fr' }));
vi.mock('@/lib/settings/runtime', () => ({ setting: (key: string) => mocks.settings[key] }));
vi.mock('../sender', () => ({ resolveLogoUrl: async () => undefined }));
vi.mock('./store', () => ({
  loadMentions: async () => ({ rows: [], directory: mocks.directory }),
}));

const { sendTemplateTest, isChannelConfigured, TEST_EVERY_MS } = await import('./test-send');

const DIRECTORY: MentionDirectory = {
  [directoryKey('discord', 'bureau')]: {
    platform: 'discord',
    kind: 'role',
    label: 'Bureau',
    externalId: '123456789012345678',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.templateTestClock = undefined;
  mocks.directory = DIRECTORY;
  mocks.settings = {
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x',
    SMTP_HOST: 'smtp.example.fr',
  };
  mocks.notify.mockResolvedValue(undefined);
  mocks.audience.mockResolvedValue({
    emails: [],
    discordIds: ['348291047563210241'],
    slackIds: ['U04ABCD1234'],
    fallsBackOnOwners: false,
  });
});

const sent = (): NotificationMessage => mocks.notify.mock.calls[0]![1];

describe('which channels can be tested', () => {
  it('needs what the channel needs to send', () => {
    expect(isChannelConfigured('discord')).toBe(true);
    mocks.settings = {};
    expect(isChannelConfigured('discord')).toBe(false);
    expect(isChannelConfigured('slack')).toBe(false);
    expect(isChannelConfigured('email')).toBe(false);
  });

  it('answers "not configured" without sending, and without spending the pause', async () => {
    mocks.settings = {};
    const input = {
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: {},
      withMentions: false,
    } as const;
    expect(await sendTemplateTest(input)).toEqual({ ok: false, code: 'notConfigured' });
    mocks.settings = { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x' };
    expect(await sendTemplateTest(input)).toEqual({ ok: true });
  });

  it('needs an address to write to for an e-mail', async () => {
    const input = {
      type: 'eventConfirmed',
      channel: 'email',
      drafts: {},
      withMentions: false,
    } as const;
    expect(await sendTemplateTest({ ...input, to: null })).toEqual({
      ok: false,
      code: 'notConfigured',
    });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(await sendTemplateTest({ ...input, to: 'paula@example.fr' })).toEqual({ ok: true });
    expect(sent()).toMatchObject({ to: 'paula@example.fr' });
  });
});

describe('what is sent', () => {
  it('is the notification as it is on the screen, marked as a test', async () => {
    await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: 'Ce soir : {title}' } },
      withMentions: false,
    });
    expect(mocks.notify.mock.calls[0]![0]).toBe('discord');
    const message = sent();
    expect(message.discord?.embeds[0]?.title).toContain('Ce soir : Soirée de rentrée');
    expect(message.discord?.above?.text).toContain('Message de test');
    expect(message.discord?.username).toBe('BDE Nice');
  });

  it('marks an e-mail and a Slack message as a test too', async () => {
    await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'email',
      drafts: {},
      withMentions: false,
      to: 'paula@example.fr',
    });
    expect(sent().subject).toMatch(/^\[Message de test\] /);
    expect(sent().email?.subject).toBe(sent().subject);
    vi.clearAllMocks();
    globalThis.templateTestClock = undefined;
    await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'slack',
      drafts: {},
      withMentions: false,
    });
    expect(String(sent().slack?.above)).toContain('Message de test');
  });

  it('writes the mentions as plain names, so nobody is notified', async () => {
    await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { own: { above: 'Allô {@everyone} {@role:bureau}' } },
      withMentions: false,
    });
    const above = sent().discord!.above!;
    // the text is defused like every text sent to a chat: the name reads the same, and cannot ping
    expect(above.text).not.toContain('@everyone');
    expect(above.text.replaceAll('​', '')).toContain('@everyone');
    expect(above.text).not.toContain('<@&');
    expect(above.text.replaceAll('​', '')).toContain('@Bureau');
    expect(above.mentions).toEqual({ everyone: false, roles: [], users: [] });
  });

  it('notifies for real only when asked to', async () => {
    await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { own: { above: 'Allô {@everyone} {@role:bureau}' } },
      withMentions: true,
    });
    const above = sent().discord!.above!;
    expect(above.mentions).toEqual({ everyone: true, roles: ['123456789012345678'], users: [] });
    expect(above.text).toContain('<@&123456789012345678>');
  });

  it('refuses a template that is not valid, naming where, and sends nothing', async () => {
    const outcome = await sendTemplateTest({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: '{nothing}' } },
      withMentions: false,
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('the pause between two tests of a channel', () => {
  const input = {
    type: 'eventConfirmed',
    channel: 'discord',
    drafts: {},
    withMentions: false,
  } as const;

  it('is ten seconds, channel by channel', async () => {
    const start = Date.now();
    expect(await sendTemplateTest(input, start)).toEqual({ ok: true });
    expect(await sendTemplateTest(input, start + 3000)).toEqual({
      ok: false,
      code: 'rateLimited',
      retryAfterSeconds: 7,
    });
    expect(await sendTemplateTest({ ...input, channel: 'slack' }, start + 3000)).toEqual({
      ok: true,
    });
    expect(await sendTemplateTest(input, start + TEST_EVERY_MS)).toEqual({ ok: true });
    expect(mocks.notify).toHaveBeenCalledTimes(3);
  });

  it('counts a test that failed too: a channel that is down is not hammered', async () => {
    const start = Date.now();
    mocks.notify.mockRejectedValue(
      Object.assign(new Error('Discord answered 500 for https://discord.com/api/webhooks/1/x'), {
        code: 'EFAIL',
      }),
    );
    const failed = await sendTemplateTest(input, start);
    expect(failed).toMatchObject({ ok: false, code: 'failed' });
    expect(JSON.stringify(failed)).not.toContain('discord.com');
    expect(await sendTemplateTest(input, start + 1000)).toMatchObject({ code: 'rateLimited' });
  });

  it('is not spent by a template that was refused', async () => {
    const start = Date.now();
    await sendTemplateTest({ ...input, drafts: { all: { title: '{nothing}' } } }, start);
    expect(await sendTemplateTest(input, start + 1)).toEqual({ ok: true });
  });
});

describe('the messages that speak to the school’s staff', () => {
  const STAFF_WEBHOOK = 'https://discord.com/api/webhooks/2/staff';
  const input = {
    type: 'intraRequested',
    channel: 'discord',
    drafts: { own: { above: 'Allô {@staff}' } },
    withMentions: false,
  } as const;

  it('are tested where they would go: the staff room when it has a webhook, the BDE room when not', async () => {
    mocks.settings = {
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x',
      DISCORD_STAFF_WEBHOOK_URL: STAFF_WEBHOOK,
    };
    await sendTemplateTest(input);
    expect(mocks.notify.mock.calls[0]![2]).toEqual({ webhookUrl: STAFF_WEBHOOK });

    vi.clearAllMocks();
    globalThis.templateTestClock = undefined;
    mocks.settings = { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x' };
    await sendTemplateTest(input);
    expect(mocks.notify.mock.calls[0]).toHaveLength(2);
  });

  it('can be tested through the staff room alone, when the BDE has no chat of its own', () => {
    mocks.settings = { DISCORD_STAFF_WEBHOOK_URL: STAFF_WEBHOOK };
    expect(isChannelConfigured('discord')).toBe(false);
    expect(isChannelConfigured('discord', 'intraRequested')).toBe(true);
    // what is not for the staff does not use its room
    expect(isChannelConfigured('discord', 'intraPublished')).toBe(false);
    expect(isChannelConfigured('slack', 'intraRequested')).toBe(false);
  });

  it('never use the staff room for what is not about the staff', async () => {
    mocks.settings = {
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x',
      DISCORD_STAFF_WEBHOOK_URL: STAFF_WEBHOOK,
    };
    await sendTemplateTest({ ...input, type: 'intraPublished', drafts: {} });
    expect(mocks.notify.mock.calls[0]).toHaveLength(2);
  });

  it('write {@staff} as a plain name by default, so nobody is notified', async () => {
    await sendTemplateTest(input);
    const above = sent().discord!.above!;
    expect(above.text).not.toContain('<@');
    expect(above.text.replaceAll('​', '')).toContain('@staff');
    expect(above.mentions).toEqual({ everyone: false, roles: [], users: [] });
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it('ping the people who gave their id, and only them, when asked to', async () => {
    await sendTemplateTest({ ...input, withMentions: true });
    const above = sent().discord!.above!;
    expect(above.text).toContain('<@348291047563210241>');
    expect(above.mentions).toEqual({ everyone: false, roles: [], users: ['348291047563210241'] });
  });

  it('are not offered {@staff} when they are not for the staff', async () => {
    const outcome = await sendTemplateTest({ ...input, type: 'intraPublished' });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  emptyMatrix,
  isConfigured,
  parseChannelForTest,
  parseNotifications,
  type NotificationSettings,
} from './notifications';

const DISCORD = 'https://discord.com/api/webhooks/123456789/secret-part';
const SLACK = 'https://hooks.slack.com/services/T123/B456/slacksecret';
const SMTP = {
  host: 'smtp.exemple.fr',
  port: '587',
  user: 'bde',
  password: 'p4ss',
  from: 'bde@exemple.fr',
};

const saved: NotificationSettings = {
  matrix: emptyMatrix(),
  discordWebhook: DISCORD,
  slackWebhook: SLACK,
  smtp: {
    host: 'smtp.exemple.fr',
    port: 587,
    user: 'bde',
    password: 'saved-pass',
    from: 'bde@exemple.fr',
  },
};

const parse = (input: Record<string, unknown>, before?: NotificationSettings) =>
  parseNotifications({ matrix: emptyMatrix(), ...input }, before);

describe('parseNotifications', () => {
  it('nothing typed and nothing ticked is valid: no channel, no notification', () => {
    expect(parse({})).toEqual({ ok: true, value: { matrix: emptyMatrix() } });
  });

  it('keeps what is saved for a channel left blank, and the channel stays tickable', () => {
    const result = parse(
      {
        matrix: { ...emptyMatrix(), memberPending: ['discord', 'slack', 'email'] },
        discordWebhook: '',
        slackWebhook: '',
      },
      saved,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { discordWebhook: DISCORD, slackWebhook: SLACK, smtp: { password: 'saved-pass' } },
    });
  });

  it('a blank mail password keeps the saved one, a typed one replaces it', () => {
    const blank = parse({ smtp: { ...SMTP, password: '' } }, saved);
    expect(blank).toMatchObject({ ok: true, value: { smtp: { password: 'saved-pass' } } });
    const typed = parse({ smtp: { ...SMTP, password: 'new-pass' } }, saved);
    expect(typed).toMatchObject({ ok: true, value: { smtp: { password: 'new-pass' } } });
  });

  it('removing a channel forgets its settings, and only its', () => {
    const result = parse({ removed: ['discord'] }, saved);
    if (!result.ok) throw new Error(result.code);
    expect(result.value.discordWebhook).toBeUndefined();
    expect(result.value.slackWebhook).toBe(SLACK);
    expect(isConfigured(result.value, 'discord')).toBe(false);
    expect(isConfigured(result.value, 'slack')).toBe(true);
  });

  it('removing a channel and typing a new address for it keeps the new one', () => {
    const result = parse({ removed: ['discord'], discordWebhook: DISCORD }, saved);
    expect(result).toMatchObject({ ok: true, value: { discordWebhook: DISCORD } });
  });

  it('refuses a box on a channel that is not set up', () => {
    expect(parse({ matrix: { ...emptyMatrix(), eventConfirmed: ['slack'] } })).toEqual({
      ok: false,
      code: 'channelNotConfigured',
      field: 'matrix',
    });
    // a channel being removed is not set up any more
    expect(
      parse(
        { matrix: { ...emptyMatrix(), eventConfirmed: ['discord'] }, removed: ['discord'] },
        saved,
      ),
    ).toMatchObject({ ok: false, code: 'channelNotConfigured' });
  });

  it('refuses the e-mail of a member who was removed, even for a channel that is set up', () => {
    expect(parse({ matrix: { ...emptyMatrix(), memberRemoved: ['email'] }, smtp: SMTP })).toEqual({
      ok: false,
      code: 'removedNotEmailed',
      field: 'matrix',
    });
  });

  it('writes a list in the order of the table, once', () => {
    const result = parse({
      matrix: { ...emptyMatrix(), eventConfirmed: ['email', 'discord', 'email'] },
      discordWebhook: DISCORD,
      smtp: SMTP,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { matrix: { eventConfirmed: ['discord', 'email'] } },
    });
  });

  it('checks every part of what is typed, with the field it belongs to', () => {
    expect(parse({ discordWebhook: 'https://evil.example/x' })).toMatchObject({
      ok: false,
      code: 'discord',
      field: 'discordWebhook',
    });
    expect(parse({ slackWebhook: 'http://hooks.slack.com/x' })).toMatchObject({
      ok: false,
      code: 'slack',
      field: 'slackWebhook',
    });
    expect(parse({ smtp: { ...SMTP, host: 'not a host' } })).toMatchObject({
      code: 'smtpHost',
      field: 'smtpHost',
    });
    expect(parse({ smtp: { ...SMTP, port: '70000' } })).toMatchObject({
      code: 'port',
      field: 'smtpPort',
    });
    expect(parse({ smtp: { ...SMTP, from: 'nope' } })).toMatchObject({
      code: 'email',
      field: 'smtpFrom',
    });
    expect(parse({ smtp: { ...SMTP, password: "it's" } })).toMatchObject({
      code: 'secretChars',
      field: 'smtpPassword',
    });
  });

  it('a mail form left empty is not a mail server, and keeps nothing it should not', () => {
    const empty = { host: '', port: '587', user: '', password: '', from: '' };
    expect(parse({ smtp: empty })).toEqual({ ok: true, value: { matrix: emptyMatrix() } });
    expect(parse({ smtp: empty }, saved)).toMatchObject({
      ok: true,
      value: { smtp: { host: 'smtp.exemple.fr' } },
    });
  });

  it.each([
    ['not an object', 'x'],
    ['no matrix', {}],
    ['an old single channel', { mode: 'discord' }],
    ['a list that is a name', { matrix: { ...emptyMatrix(), memberPending: 'discord' } }],
    [
      'a channel that does not exist',
      { matrix: { ...emptyMatrix(), memberPending: ['carrier-pigeon'] } },
    ],
    ['none inside a list', { matrix: { ...emptyMatrix(), memberPending: ['none'] } }],
    ['a type missing', { matrix: { memberPending: [] } }],
  ])('refuses %s', (_name, input) => {
    expect(parseNotifications(input)).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('parseChannelForTest: the credentials of ONE channel', () => {
  it('reads only the channel asked for: a typo in another one does not stop the test', () => {
    const result = parseChannelForTest(
      { discordWebhook: DISCORD, slackWebhook: 'http://nope', smtp: { ...SMTP, host: 'bad host' } },
      'discord',
    );
    expect(result).toEqual({ ok: true, value: { discordWebhook: DISCORD } });
  });

  it('uses what is saved when the field is blank, and says what is wrong with what is typed', () => {
    expect(parseChannelForTest({ discordWebhook: '' }, 'discord', saved)).toEqual({
      ok: true,
      value: { discordWebhook: DISCORD },
    });
    expect(parseChannelForTest({ slackWebhook: 'http://nope' }, 'slack', saved)).toMatchObject({
      ok: false,
      code: 'slack',
      field: 'slackWebhook',
    });
  });

  it('refuses a channel with nothing typed or saved, and one that was removed', () => {
    expect(parseChannelForTest({}, 'slack')).toEqual({ ok: false, code: 'invalid' });
    expect(parseChannelForTest({ removed: ['slack'] }, 'slack', saved)).toEqual({
      ok: false,
      code: 'invalid',
    });
  });

  it('reads the mail server, with the saved password when it is left blank', () => {
    expect(parseChannelForTest({ smtp: { ...SMTP, password: '' } }, 'email', saved)).toMatchObject({
      ok: true,
      value: { smtp: { host: 'smtp.exemple.fr', password: 'saved-pass' } },
    });
  });
});

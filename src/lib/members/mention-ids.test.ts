import { describe, expect, it } from 'vitest';
import { parseDiscordUserId, parseMentionIds, parseSlackUserId } from './mention-ids';

describe('a Discord user id', () => {
  it.each([
    ['348291047563210241', '348291047563210241'],
    ['  348291047563210241  ', '348291047563210241'],
    ['<@348291047563210241>', '348291047563210241'],
    ['<@!348291047563210241>', '348291047563210241'],
    ['12345678901234567', '12345678901234567'],
    ['12345678901234567890', '12345678901234567890'],
  ])('keeps %j as %s', (input, value) => {
    expect(parseDiscordUserId(input)).toEqual({ ok: true, value });
  });

  it.each(['', '   '])('removes the id when the answer is blank (%j)', (input) => {
    expect(parseDiscordUserId(input)).toEqual({ ok: true, value: null });
  });

  it.each([
    'paula',
    '@paula',
    '@everyone',
    '@here',
    '<@&348291047563210241>',
    '<@348291047563210241> <@348291047563210242>',
    '3482910475632102',
    '123456789012345678901',
    '3482910475632102a1',
    '348291047563210241\n@everyone',
    '<@>',
  ])('refuses %j', (input) => {
    expect(parseDiscordUserId(input)).toEqual({ ok: false });
  });
});

describe('a Slack member id', () => {
  it.each([
    ['U04ABCD1234', 'U04ABCD1234'],
    ['w04abcd1234', 'W04ABCD1234'],
    ['<@U04ABCD1234>', 'U04ABCD1234'],
    ['U0ABCDEFG', 'U0ABCDEFG'],
    ['UABCDEFGHIJKL', 'UABCDEFGHIJKL'],
  ])('keeps %j as %s', (input, value) => {
    expect(parseSlackUserId(input)).toEqual({ ok: true, value });
  });

  it('removes the id when the answer is blank', () => {
    expect(parseSlackUserId('  ')).toEqual({ ok: true, value: null });
  });

  it.each([
    'paula',
    '@channel',
    '<!channel>',
    '<!here>',
    'C04ABCD1234',
    'T04ABCD1234',
    'U0ABCDEF',
    'UABCDEFGHIJKLM',
    'U04ABCD123!',
    'U04ABCD1234 U04ABCD1235',
    '<@U04ABCD1234|paula>',
  ])('refuses %j', (input) => {
    expect(parseSlackUserId(input)).toEqual({ ok: false });
  });
});

describe('both together', () => {
  it('gives the two ids, either of which may be empty', () => {
    expect(parseMentionIds({ discordUserId: '348291047563210241', slackUserId: '' })).toEqual({
      ok: true,
      data: { discordUserId: '348291047563210241', slackUserId: null },
    });
  });

  it('names every field that is wrong', () => {
    expect(parseMentionIds({ discordUserId: '@everyone', slackUserId: '!channel' })).toEqual({
      ok: false,
      errors: { discordUserId: 'invalid', slackUserId: 'invalid' },
    });
    expect(parseMentionIds({ discordUserId: '', slackUserId: 'nope' })).toEqual({
      ok: false,
      errors: { slackUserId: 'invalid' },
    });
  });
});

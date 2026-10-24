import { describe, expect, it } from 'vitest';
import { STAFF_TYPES } from './kinds';
import { mentionsIn, renderAbove, type StaffMentionIds } from './mentions';
import { validateTemplate, type TemplateScope } from './schema';
import type { TemplateType } from './types';

/**
 * `{@staff}`: the mention of the school's staff, in the messages that speak to it. It stands for the people who gave their Discord or
 * Slack id on their profile: the template never types an id, and nothing a member wrote can make one.
 */

const ZWSP = '​';
const STAFF: StaffMentionIds = {
  discord: ['348291047563210241', '348291047563210242'],
  slack: ['U04ABCD1234'],
};

describe('rendering {@staff}', () => {
  it('writes each person as the platform’s own mention, and allows exactly those people to be pinged (Discord)', () => {
    const above = renderAbove('Allô {@staff} !', {}, 'discord', {}, STAFF)!;
    expect(above.text).toBe('Allô <@348291047563210241> <@348291047563210242> !');
    expect(above.mentions).toEqual({
      everyone: false,
      roles: [],
      users: ['348291047563210241', '348291047563210242'],
    });
  });

  it('writes the Slack members the same way', () => {
    const above = renderAbove('{@staff}', {}, 'slack', {}, STAFF)!;
    expect(above.text).toBe('<@U04ABCD1234>');
  });

  it('mentions nobody when nobody gave their id: the sentence stays, with nothing to ping', () => {
    expect(
      renderAbove('Allô {@staff} !', {}, 'discord', {}, { discord: [], slack: [] })!.text,
    ).toBe('Allô  !');
    expect(renderAbove('Allô {@staff} !', {}, 'discord')!.mentions.users).toEqual([]);
    expect(renderAbove('{@staff}', {}, 'discord')).toBeUndefined();
  });

  it('is the people of the platform asked for, never the other platform’s', () => {
    expect(
      renderAbove('{@staff}', {}, 'discord', {}, { discord: [], slack: ['U04ABCD1234'] }),
    ).toBeUndefined();
  });

  it('is only read where the template spells it: the same words typed in a variable or as text are defused', () => {
    const above = renderAbove(
      '{title} @staff',
      { title: '{@staff} @everyone' },
      'discord',
      {},
      STAFF,
    )!;
    expect(above.text).not.toContain('<@');
    expect(above.text).toContain(`@${ZWSP}everyone`);
    expect(above.mentions).toEqual({ everyone: false, roles: [], users: [] });
  });

  it('is read among the mentions of a text', () => {
    expect(mentionsIn('a {@staff} b {@everyone}')).toEqual([
      { kind: 'staff' },
      { kind: 'everyone' },
    ]);
  });

  it('does not ping a person whose mention was cut off by the limit of a message', () => {
    const long = 'x'.repeat(1990);
    const above = renderAbove(`${long} {@staff}`, {}, 'discord', {}, STAFF)!;
    expect(above.text).not.toContain('<@');
    expect(above.mentions.users).toEqual([]);
  });
});

describe('where {@staff} may be written', () => {
  const check = (type: TemplateType, scope: TemplateScope) =>
    validateTemplate(type, scope, { above: 'Allô {@staff}' });

  it.each(STAFF_TYPES)(
    'in a message to the staff (%s), for all channels and for each chat',
    (type) => {
      for (const scope of ['all', 'discord', 'slack'] as const) {
        expect(check(type, scope)).toMatchObject({ ok: true });
      }
    },
  );

  it.each([
    'intraPublished',
    'intraRefused',
    'eventConfirmed',
    'eventProposed',
    'memberPending',
  ] as const)('nowhere else: the %s would ping the staff for nothing', (type) => {
    expect(check(type, 'discord')).toMatchObject({
      ok: false,
      issues: [{ path: 'above', code: 'mentionNotForType' }],
    });
  });

  it('not in an e-mail, which has no message above its card', () => {
    expect(check('intraRequested', 'email')).toMatchObject({
      ok: false,
      issues: [{ path: 'above', code: 'notForEmail' }],
    });
  });

  it('not inside a card (the only place a mention is read is the message above it)', () => {
    expect(validateTemplate('intraRequested', 'discord', { title: '{@staff}' })).toMatchObject({
      ok: false,
      issues: [{ path: 'title', code: 'mentionNotAllowed' }],
    });
  });
});

describe('the variables of the messages about the intra', () => {
  it.each([
    ['intraRequested', '{requester}'],
    ['intraChanged', '{editor}'],
    ['intraCancelled', '{cause}'],
    ['intraPublished', '{intra_link}'],
    ['intraRefused', '{comment}'],
  ] as const)('%s offers %s', (type, variable) => {
    expect(validateTemplate(type, 'discord', { title: `x ${variable}` })).toMatchObject({
      ok: true,
    });
  });

  it('and not those of another message', () => {
    expect(validateTemplate('intraRequested', 'discord', { title: '{comment}' })).toMatchObject({
      ok: false,
      issues: [{ code: 'unknownVariable' }],
    });
    expect(validateTemplate('eventConfirmed', 'discord', { title: '{requester}' })).toMatchObject({
      ok: false,
    });
  });
});

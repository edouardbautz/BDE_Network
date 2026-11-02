import { describe, expect, it } from 'vitest';
import { AUTHOR_TYPES } from './kinds';
import { mentionsIn, renderAbove, type StaffMentionIds } from './mentions';
import { validateTemplate, type TemplateScope } from './schema';
import { ITEMS } from './catalog';
import type { TemplateType } from './types';

const TEMPLATE_TYPES = Object.keys(ITEMS) as TemplateType[];

/**
 * `{@author}`: the mention of the author of an event that came from a proposal, in the announcement of the event. It stands for ONE person, by
 * the Discord or Slack id they gave on their profile: the template never types an id, nothing a member wrote can make one, and it is not the
 * staff's (`{@staff}` is another list).
 */

const AUTHOR: StaffMentionIds = { discord: ['348291047563210241'], slack: ['U04ABCD1234'] };
const STAFF: StaffMentionIds = { discord: ['348291047563210299'], slack: ['U04STAFF999'] };

describe('rendering {@author}', () => {
  it('pings the author by their id, and allows exactly that person to be pinged', () => {
    const above = renderAbove('Bravo {@author} !', {}, 'discord', {}, STAFF, AUTHOR)!;
    expect(above.text).toBe('Bravo <@348291047563210241> !');
    expect(above.mentions).toEqual({ everyone: false, roles: [], users: ['348291047563210241'] });
    expect(renderAbove('{@author}', {}, 'slack', {}, undefined, AUTHOR)!.text).toBe(
      '<@U04ABCD1234>',
    );
  });

  it('is not the staff: the two lists never mix', () => {
    const above = renderAbove('{@staff} {@author}', {}, 'discord', {}, STAFF, AUTHOR)!;
    expect(above.mentions.users).toEqual(['348291047563210299', '348291047563210241']);
    expect(renderAbove('{@author}', {}, 'discord', {}, STAFF)).toBeUndefined();
  });

  it('mentions nobody when the author gave no id for the platform', () => {
    expect(
      renderAbove('{@author}', {}, 'discord', {}, undefined, {
        discord: [],
        slack: ['U04ABCD1234'],
      }),
    ).toBeUndefined();
  });

  it('is only read where the template spells it: the same words in a variable are defused', () => {
    const above = renderAbove(
      '{title}',
      { title: '{@author} <@348291047563210241>' },
      'discord',
      {},
      undefined,
      AUTHOR,
    )!;
    expect(above.mentions.users).toEqual([]);
    expect(above.text).not.toContain('<@348291047563210241>');
  });

  it('is read as a mention by the parser', () => {
    expect(mentionsIn('a {@author} b')).toEqual([{ kind: 'author' }]);
  });
});

describe('validating {@author}', () => {
  const issues = (type: TemplateType, scope: TemplateScope, above: string) => {
    const result = validateTemplate(type, scope, { above });
    return result.ok ? [] : result.issues.map((issue) => issue.code);
  };

  it('is accepted in the announcement of an event, for all the channels and for each chat', () => {
    expect(AUTHOR_TYPES).toEqual(['eventConfirmed']);
    for (const scope of ['all', 'discord', 'slack'] as const) {
      expect(issues('eventConfirmed', scope, 'Bravo {@author}')).toEqual([]);
    }
  });

  it('is refused everywhere else: it would ping a person for a message that is not about them', () => {
    for (const type of TEMPLATE_TYPES.filter((type) => !AUTHOR_TYPES.includes(type))) {
      expect(issues(type, 'discord', '{@author}')).toContain('mentionAuthorNotForType');
    }
  });

  it('is refused in an e-mail, which has no message above the card', () => {
    expect(issues('eventConfirmed', 'email', '{@author}').length).toBeGreaterThan(0);
  });
});

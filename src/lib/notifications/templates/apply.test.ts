import { describe, expect, it } from 'vitest';
import { cascade, resolveItems, withEmoji } from './apply';
import { ITEMS, VARIABLES, channelsOfType, nativeOrder, sharedChannels } from './catalog';
import {
  TEMPLATE_CHANNELS,
  type TemplateContent,
  type TemplateItem,
  type TemplateType,
} from './types';

const TYPES = Object.keys(ITEMS) as TemplateType[];
const on = (id: TemplateItem['id'], more: Partial<TemplateItem> = {}): TemplateItem => ({
  id,
  enabled: true,
  ...more,
});
const ids = (items: ReturnType<typeof resolveItems>) => items.map((item) => item.id);

describe('the catalog', () => {
  it.each(TYPES)('%s: every channel shows only items the type has, each at most once', (type) => {
    for (const channel of TEMPLATE_CHANNELS) {
      const order = nativeOrder(channel, type);
      expect(new Set(order).size).toBe(order.length);
      for (const id of order) expect(ITEMS[type]).toContain(id);
    }
  });

  it.each(TYPES)('%s: the items of the editor are shown by some channel', (type) => {
    const shown = new Set(TEMPLATE_CHANNELS.flatMap((channel) => nativeOrder(channel, type)));
    for (const id of ITEMS[type]) expect(shown).toContain(id);
  });

  it('knows the order each channel shows an event in: they differ', () => {
    expect(nativeOrder('discord', 'eventConfirmed')).toEqual([
      'when',
      'where',
      'description',
      'category',
      'assignees',
      'repeats',
    ]);
    expect(nativeOrder('slack', 'eventConfirmed')).toEqual([
      'description',
      'when',
      'where',
      'category',
      'assignees',
      'repeats',
    ]);
    expect(nativeOrder('email', 'eventConfirmed')).toEqual([
      'description',
      'when',
      'repeats',
      'where',
      'category',
      'assignees',
    ]);
  });

  it('has the reason of a refusal first, and only in the refusal', () => {
    expect(nativeOrder('discord', 'eventRefused')[0]).toBe('reason');
    expect(nativeOrder('slack', 'eventRefused')[0]).toBe('reason');
    expect(nativeOrder('email', 'eventRefused')[0]).toBe('reason');
    for (const type of TYPES.filter((type) => type !== 'eventRefused')) {
      expect(ITEMS[type]).not.toContain('reason');
    }
  });

  it('writes the e-mail to an approved member about their own access only', () => {
    expect(nativeOrder('email', 'memberApproved')).toEqual(['summary', 'role']);
  });

  it('writes nothing to a member who was removed by e-mail, and the shared template does not reach an approved member’s e-mail', () => {
    expect(channelsOfType('memberRemoved')).toEqual(['discord', 'slack']);
    expect(channelsOfType('memberPending')).toEqual(['discord', 'slack', 'email']);
    expect(sharedChannels('memberApproved')).toEqual(['discord', 'slack']);
    expect(sharedChannels('eventConfirmed')).toEqual(['discord', 'slack', 'email']);
  });

  it.each(TYPES)('%s: its variables are written the way a text reads them, once each', (type) => {
    const variables = VARIABLES[type] as readonly string[];
    expect(new Set(variables).size).toBe(variables.length);
    for (const variable of variables) expect(variable).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(variables).toContain('bde');
  });

  it('gives the proposal circuit its own variables, and the reminder its day', () => {
    expect(VARIABLES.eventRefused).toEqual(
      expect.arrayContaining(['author', 'reviewer', 'comment']),
    );
    expect(VARIABLES.eventProposed).toContain('author');
    expect(VARIABLES.eventProposed).not.toContain('reviewer');
    expect(VARIABLES.eventReminder).toContain('day');
    expect(VARIABLES.eventConfirmed).not.toContain('day');
  });
});

describe('resolveItems', () => {
  it('shows what the channel shows, in its own order, when nothing is chosen', () => {
    expect(ids(resolveItems(undefined, 'slack', 'eventConfirmed'))).toEqual(
      nativeOrder('slack', 'eventConfirmed'),
    );
    expect(ids(resolveItems({}, 'discord', 'eventConfirmed'))).toEqual(
      nativeOrder('discord', 'eventConfirmed'),
    );
  });

  it('shows only the items that are listed and switched on', () => {
    const template: TemplateContent = {
      items: {
        order: 'native',
        list: [on('when'), { id: 'where', enabled: false }, on('category')],
      },
    };
    expect(ids(resolveItems(template, 'discord', 'eventConfirmed'))).toEqual(['when', 'category']);
  });

  it('does not show an item of the type that is not in the list: a later version adds items without changing a template', () => {
    const template: TemplateContent = { items: { order: 'native', list: [on('when')] } };
    expect(ids(resolveItems(template, 'email', 'eventConfirmed'))).toEqual(['when']);
  });

  it('keeps the channel’s own order of the facts when the order is native, whatever the list says', () => {
    const template: TemplateContent = {
      items: { order: 'native', list: [on('category'), on('when'), on('where')] },
    };
    expect(ids(resolveItems(template, 'discord', 'eventConfirmed'))).toEqual([
      'when',
      'where',
      'category',
    ]);
    expect(ids(resolveItems(template, 'email', 'eventConfirmed'))).toEqual([
      'when',
      'where',
      'category',
    ]);
  });

  it('follows the order of the list when the BDE ordered the items', () => {
    const template: TemplateContent = {
      items: { order: 'custom', list: [on('category'), on('when'), on('where')] },
    };
    for (const channel of TEMPLATE_CHANNELS) {
      expect(ids(resolveItems(template, channel, 'eventConfirmed'))).toEqual([
        'category',
        'when',
        'where',
      ]);
    }
  });

  it('puts free texts after the facts when the order is the channel’s, and in place when it is the BDE’s', () => {
    const list = [on('text:a', { text: 'Hello' }), on('when'), on('category')];
    expect(
      ids(resolveItems({ items: { order: 'native', list } }, 'discord', 'eventConfirmed')),
    ).toEqual(['when', 'category', 'text:a']);
    expect(
      ids(resolveItems({ items: { order: 'custom', list } }, 'discord', 'eventConfirmed')),
    ).toEqual(['text:a', 'when', 'category']);
  });

  it('ignores an item the channel does not show for this type, a repeated one and one that is off', () => {
    const template: TemplateContent = {
      items: {
        order: 'custom',
        list: [
          on('login'),
          on('role'),
          on('role'),
          on('summary'),
          { id: 'campus', enabled: false },
        ],
      },
    };
    // the e-mail to an approved member shows the sentence and the role only
    expect(ids(resolveItems(template, 'email', 'memberApproved'))).toEqual(['role', 'summary']);
  });

  it('carries the label, the emoji and the text the BDE gave', () => {
    const template: TemplateContent = {
      items: {
        order: 'native',
        list: [
          on('when', { label: 'Quand ça ?', emoji: '🗓️' }),
          on('text:a', { text: 'Hi', emoji: '' }),
        ],
      },
    };
    expect(resolveItems(template, 'slack', 'eventConfirmed')).toEqual([
      { id: 'when', custom: false, label: 'Quand ça ?', emoji: '🗓️' },
      { id: 'text:a', custom: true, text: 'Hi', emoji: '' },
    ]);
  });
});

describe('withEmoji', () => {
  it('puts the emoji in front, and nothing when there is none', () => {
    expect(withEmoji('📅', 'When')).toBe('📅 When');
    expect(withEmoji(undefined, 'When')).toBe('When');
    expect(withEmoji('', 'When')).toBe('When');
  });
});

describe('cascade', () => {
  it('lets a channel’s change win over the one shared by every channel, field by field', () => {
    const shared: TemplateContent = {
      title: 'A',
      footer: 'F',
      button: { label: 'Go', enabled: true },
    };
    const own: TemplateContent = { title: 'B', button: { label: 'Open' } };
    expect(cascade(shared, own)).toEqual({
      title: 'B',
      footer: 'F',
      button: { label: 'Open', enabled: true },
    });
  });

  it('is what exists when only one of them does, and nothing when neither does', () => {
    const one: TemplateContent = { title: 'A' };
    expect(cascade(one, undefined)).toBe(one);
    expect(cascade(undefined, one)).toBe(one);
    expect(cascade(undefined, undefined)).toBeUndefined();
  });
});

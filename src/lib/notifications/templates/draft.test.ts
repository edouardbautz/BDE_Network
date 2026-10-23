import { describe, expect, it } from 'vitest';
import {
  buttonShown,
  channelsOf,
  isBlank,
  isOwnText,
  itemRows,
  moveRow,
  newTextId,
  orderOf,
  textOf,
  tidy,
  withButton,
  withColor,
  withEmoji,
  withItems,
  withText,
} from './draft';
import { commonDefaults, type ChannelDefaults } from './defaults-shape';
import type { TemplateContent } from './types';

const DISCORD: ChannelDefaults = {
  eyebrow: 'New event confirmed',
  title: '{title}',
  emoji: '🎉',
  footer: 'BDE_Network',
  button: { label: 'View the event', native: false },
  items: {
    when: { label: 'When', emoji: '📅' },
    where: { label: 'Where', emoji: '📍' },
    description: {},
    category: { label: 'Category', emoji: '🏷️' },
    assignees: { label: 'Members in charge', emoji: '👥' },
    repeats: { label: 'Repeats', emoji: '🔁' },
  },
};
const EMAIL: ChannelDefaults = {
  ...DISCORD,
  emoji: '',
  footer: 'You receive this because you are a member of {bde}.',
  button: { label: 'View the event', native: true },
  subject: 'New event confirmed: {title}',
  note: 'The attached file adds the event to your calendar.',
  items: {
    when: { label: 'When' },
    where: { label: 'Where' },
    description: {},
    category: { label: 'Category' },
    assignees: { label: 'Members in charge' },
    repeats: { label: 'Repeats' },
  },
};
const FACTS = ['when', 'repeats', 'where', 'description', 'category', 'assignees'];

describe('the text of a field', () => {
  it('shows the platform’s words until the BDE writes its own', () => {
    expect(textOf(null, 'eyebrow', DISCORD)).toBe('New event confirmed');
    expect(textOf({}, 'title', DISCORD)).toBe('{title}');
    expect(textOf({ title: 'Mine' }, 'title', DISCORD)).toBe('Mine');
    expect(textOf(undefined, 'footer', EMAIL)).toBe(EMAIL.footer);
    expect(textOf(null, 'subject', EMAIL)).toBe('New event confirmed: {title}');
    expect(textOf(null, 'note', EMAIL)).toBe(EMAIL.note);
  });

  it('shows nothing for what the platform has no words for', () => {
    expect(textOf(null, 'preheader', EMAIL)).toBe('');
    expect(textOf(null, 'above', DISCORD)).toBe('');
    expect(textOf(null, 'subject', DISCORD)).toBe('');
    expect(textOf({ preheader: 'x' }, 'preheader', EMAIL)).toBe('x');
  });

  it('knows a text is the BDE’s, even when it is empty', () => {
    expect(isOwnText({ title: 'x' }, 'title')).toBe(true);
    expect(isOwnText({}, 'title')).toBe(false);
    expect(isOwnText(null, 'title')).toBe(false);
  });

  it('stores what the BDE wrote, and forgets what only says the platform’s words, or nothing', () => {
    expect(withText({}, 'title', 'Mine', DISCORD)).toEqual({ title: 'Mine' });
    expect(withText({ title: 'Mine' }, 'title', '{title}', DISCORD)).toEqual({});
    expect(withText({ title: 'Mine' }, 'title', '   ', DISCORD)).toEqual({});
    expect(withText({ above: 'x' }, 'above', '', DISCORD)).toEqual({});
    expect(withText({}, 'above', '@x', DISCORD)).toEqual({ above: '@x' });
    expect(withText({ footer: 'x' }, 'footer', 'BDE_Network', DISCORD)).toEqual({});
  });

  it('keeps the other fields', () => {
    expect(withText({ color: '#112233' }, 'eyebrow', 'Hi', DISCORD)).toEqual({
      color: '#112233',
      eyebrow: 'Hi',
    });
  });
});

describe('emoji and colour', () => {
  it('keeps the platform’s emoji as none, and the BDE’s own (or none at all) as one', () => {
    expect(withEmoji({}, '🥳', DISCORD)).toEqual({ emoji: '🥳' });
    expect(withEmoji({ emoji: '🥳' }, '🎉', DISCORD)).toEqual({});
    expect(withEmoji({}, '', DISCORD)).toEqual({ emoji: '' });
    expect(withEmoji({}, '', EMAIL)).toEqual({});
  });

  it('sets the colour, or goes back to automatic', () => {
    expect(withColor({}, '#aabbcc')).toEqual({ color: '#aabbcc' });
    expect(withColor({ color: '#aabbcc', title: 'x' }, null)).toEqual({ title: 'x' });
  });
});

describe('the button', () => {
  it('is shown the way the channel does it, or as the BDE chose', () => {
    expect(buttonShown(null, DISCORD)).toBe(false);
    expect(buttonShown({}, EMAIL)).toBe(true);
    expect(buttonShown({ button: { enabled: true } }, DISCORD)).toBe(true);
    expect(buttonShown({ button: { enabled: false } }, EMAIL)).toBe(false);
  });

  it('stores a choice only when it differs from the channel’s way', () => {
    expect(withButton({}, { enabled: true }, DISCORD)).toEqual({ button: { enabled: true } });
    expect(withButton({ button: { enabled: true } }, { enabled: false }, DISCORD)).toEqual({});
    expect(withButton({}, { enabled: false }, EMAIL)).toEqual({ button: { enabled: false } });
    expect(withButton({ button: { enabled: false } }, { enabled: true }, EMAIL)).toEqual({});
  });

  it('stores a label only when it is not the platform’s, and an address only when there is one', () => {
    expect(withButton({}, { label: 'Open' }, EMAIL)).toEqual({ button: { label: 'Open' } });
    expect(withButton({ button: { label: 'Open' } }, { label: 'View the event' }, EMAIL)).toEqual(
      {},
    );
    expect(withButton({ button: { label: 'Open' } }, { label: '  ' }, EMAIL)).toEqual({});
    expect(withButton({}, { url: 'https://forms.example.fr/x' }, EMAIL)).toEqual({
      button: { url: 'https://forms.example.fr/x' },
    });
    expect(withButton({ button: { url: 'https://x.fr' } }, { url: null }, EMAIL)).toEqual({});
    expect(withButton({ button: { url: 'https://x.fr' } }, { url: ' ' }, EMAIL)).toEqual({});
  });

  it('turns the button on when an address is given for a channel that has none by itself', () => {
    expect(withButton({}, { url: 'https://forms.example.fr/x' }, DISCORD)).toEqual({
      button: { url: 'https://forms.example.fr/x', enabled: true },
    });
  });
});

describe('the list of facts', () => {
  it('lists every fact of the type, switched on, with the platform’s words, when the BDE changed nothing', () => {
    const rows = itemRows('eventConfirmed', null, DISCORD);
    expect(rows.map((row) => row.id)).toEqual(FACTS);
    expect(rows.every((row) => row.enabled && !row.custom && !row.ownLabel && !row.ownEmoji)).toBe(
      true,
    );
    expect(rows[0]).toMatchObject({ label: 'When', emoji: '📅' });
    expect(rows[3]).toMatchObject({ id: 'description', label: '', emoji: '' });
    expect(itemRows('eventConfirmed', null, EMAIL)[0]).toMatchObject({ label: 'When', emoji: '' });
  });

  it('shows what the BDE wrote, in its order, and a fact that is not in its list as switched off', () => {
    const rows = itemRows(
      'eventConfirmed',
      {
        items: {
          order: 'custom',
          list: [
            { id: 'where', enabled: true, label: 'Place', emoji: '🏟️' },
            { id: 'text:ab12', enabled: true, text: 'Hello' },
            { id: 'when', enabled: false },
          ],
        },
      },
      DISCORD,
    );
    expect(rows.map((row) => [row.id, row.enabled])).toEqual([
      ['where', true],
      ['text:ab12', true],
      ['when', false],
      ['repeats', false],
      ['description', false],
      ['category', false],
      ['assignees', false],
    ]);
    expect(rows[0]).toMatchObject({ label: 'Place', ownLabel: true, emoji: '🏟️', ownEmoji: true });
    expect(rows[1]).toMatchObject({ custom: true, text: 'Hello', ownText: true });
    expect(rows[2]).toMatchObject({ label: 'When', ownLabel: false });
  });

  it('shows the sentence of a member’s summary, the platform’s until the BDE writes its own', () => {
    const defaults: ChannelDefaults = {
      ...DISCORD,
      items: {
        summary: { text: '{name} is asking for access.' },
        login: { label: 'Login', emoji: '🪪' },
      },
    };
    expect(itemRows('memberPending', null, defaults)[0]).toMatchObject({
      id: 'summary',
      text: '{name} is asking for access.',
      ownText: false,
    });
    expect(
      itemRows(
        'memberPending',
        { items: { order: 'native', list: [{ id: 'summary', enabled: true, text: 'Hi' }] } },
        defaults,
      )[0],
    ).toMatchObject({ text: 'Hi', ownText: true });
  });
});

describe('writing the list back', () => {
  const rows = () => itemRows('eventConfirmed', null, DISCORD);

  it('is no list at all when it only repeats the platform', () => {
    expect(
      withItems({ title: 'x' }, 'eventConfirmed', rows(), { order: 'native' }, DISCORD),
    ).toEqual({
      title: 'x',
    });
  });

  it('stores a fact that is switched off, with the order the channels keep', () => {
    const changed = rows().map((row) => (row.id === 'where' ? { ...row, enabled: false } : row));
    const result = withItems({}, 'eventConfirmed', changed, { order: 'native' }, DISCORD);
    expect(result.items?.order).toBe('native');
    expect(result.items?.list.find((item) => item.id === 'where')).toEqual({
      id: 'where',
      enabled: false,
    });
    expect(result.items?.list.filter((item) => item.enabled)).toHaveLength(5);
  });

  it('stores a label and an emoji only when they differ from the platform’s', () => {
    const changed = rows().map((row) =>
      row.id === 'category'
        ? { ...row, label: 'Genre', ownLabel: true, emoji: '🎭', ownEmoji: true }
        : row.id === 'when'
          ? { ...row, emoji: '', ownEmoji: true }
          : row,
    );
    const list = withItems({}, 'eventConfirmed', changed, { order: 'native' }, DISCORD).items!.list;
    expect(list.find((item) => item.id === 'category')).toEqual({
      id: 'category',
      enabled: true,
      label: 'Genre',
      emoji: '🎭',
    });
    expect(list.find((item) => item.id === 'when')).toEqual({
      id: 'when',
      enabled: true,
      emoji: '',
    });
    expect(list.find((item) => item.id === 'where')).toEqual({ id: 'where', enabled: true });
  });

  it('stores the BDE’s order once it moved a fact, and a free text with its words', () => {
    const moved = moveRow(rows(), 2, -1);
    const withText = [
      ...moved,
      {
        id: 'text:abc123',
        enabled: true,
        custom: true,
        label: '',
        ownLabel: false,
        emoji: '',
        ownEmoji: false,
        text: 'Hello **you**',
        ownText: true,
      } as const,
    ];
    const result = withItems({}, 'eventConfirmed', withText, { order: 'custom' }, DISCORD);
    expect(result.items?.order).toBe('custom');
    expect(result.items?.list.slice(0, 3).map((item) => item.id)).toEqual([
      'when',
      'where',
      'repeats',
    ]);
    expect(result.items?.list.at(-1)).toEqual({
      id: 'text:abc123',
      enabled: true,
      text: 'Hello **you**',
    });
  });

  it('stores the sentence of a summary only when it is not the platform’s', () => {
    const defaults: ChannelDefaults = {
      ...DISCORD,
      items: {
        summary: { text: '{name} asks.' },
        login: { label: 'Login', emoji: '🪪' },
        campus: {},
      },
    };
    const base = itemRows('memberPending', null, defaults);
    expect(withItems({}, 'memberPending', base, { order: 'native' }, defaults)).toEqual({});
    const edited = base.map((row) =>
      row.id === 'summary' ? { ...row, text: '{name} knocks.' } : row,
    );
    expect(
      withItems({}, 'memberPending', edited, { order: 'native' }, defaults).items?.list[0],
    ).toEqual({ id: 'summary', enabled: true, text: '{name} knocks.' });
  });

  it('round-trips: what was stored comes back as the same list', () => {
    const stored: TemplateContent = {
      items: {
        order: 'custom',
        list: [
          { id: 'where', enabled: true, label: 'Place' },
          { id: 'when', enabled: false },
          { id: 'repeats', enabled: true },
          { id: 'description', enabled: true },
          { id: 'category', enabled: true, emoji: '' },
          { id: 'assignees', enabled: true },
        ],
      },
    };
    const back = withItems(
      {},
      'eventConfirmed',
      itemRows('eventConfirmed', stored, DISCORD),
      { order: 'custom' },
      DISCORD,
    );
    expect(back).toEqual(stored);
  });
});

describe('moving a fact', () => {
  const rows = itemRows('eventConfirmed', null, DISCORD);

  it('moves it one place, and does not move the first up or the last down', () => {
    expect(
      moveRow(rows, 1, 1)
        .map((row) => row.id)
        .slice(0, 3),
    ).toEqual(['when', 'where', 'repeats']);
    expect(moveRow(rows, 0, -1)).toEqual(rows);
    expect(moveRow(rows, rows.length - 1, 1)).toEqual(rows);
    expect(moveRow(rows, 3, -1)[2]?.id).toBe('description');
  });

  it('leaves the list it was given alone', () => {
    const before = rows.map((row) => row.id);
    moveRow(rows, 2, -1);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('a new free text', () => {
  it('gets an identifier no other row has, written in the shape the validation accepts', () => {
    const rows = itemRows('eventConfirmed', null, DISCORD);
    const id = newTextId(rows);
    expect(id).toMatch(/^text:[a-z0-9]{6}$/);
    // the first draw is taken: it draws again
    const taken = [{ ...rows[0]!, id: 'text:aaaaaa' as const }];
    const draws = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    expect(newTextId(taken, () => draws.shift() ?? 0.9)).toBe('text:ssssss');
  });
});

describe('what a template says', () => {
  it('knows the order the BDE stored, and the channels’ own without one', () => {
    expect(orderOf(null)).toBe('native');
    expect(orderOf({})).toBe('native');
    expect(orderOf({ items: { order: 'custom', list: [] } })).toBe('custom');
  });

  it('is blank when it says nothing, however many empty objects it holds', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank({})).toBe(true);
    expect(isBlank({ button: {} })).toBe(true);
    expect(isBlank({ title: 'x' })).toBe(false);
    expect(isBlank({ emoji: '' })).toBe(false);
  });

  it('tidies away empty objects and undefined fields', () => {
    expect(tidy({ title: undefined, button: { label: undefined } } as TemplateContent)).toEqual({});
    expect(tidy({ button: { enabled: false, url: undefined } } as TemplateContent)).toEqual({
      button: { enabled: false },
    });
  });

  it('knows which channels a tab stands for', () => {
    expect(channelsOf('all', ['discord', 'slack', 'email'])).toEqual(['discord', 'slack', 'email']);
    expect(channelsOf('slack', ['discord', 'slack'])).toEqual(['slack']);
  });
});

describe('what the platform says for all channels', () => {
  it('keeps what they have in common and nothing where they differ', () => {
    const common = commonDefaults({ discord: DISCORD, email: EMAIL });
    expect(common.eyebrow).toBe('New event confirmed');
    expect(common.title).toBe('{title}');
    expect(common.emoji).toBe('');
    expect(common.footer).toBe('');
    expect(common.button.native).toBe(true);
    expect(common.items.when).toEqual({ label: 'When' });
    expect(common.subject).toBeUndefined();
  });

  it('works from whichever channels there are', () => {
    expect(commonDefaults({ email: EMAIL }).items.where).toEqual({ label: 'Where' });
    expect(commonDefaults({ slack: EMAIL }).button.label).toBe('View the event');
  });
});

describe('the facts a channel can show', () => {
  const NATIVE = ['when', 'where', 'description', 'category', 'assignees', 'repeats'] as const;

  it('lists them in the channel’s own order until the BDE orders them', () => {
    const rows = itemRows('eventConfirmed', null, DISCORD, NATIVE);
    expect(rows.map((row) => row.id)).toEqual([...NATIVE]);
    expect(
      withItems({}, 'eventConfirmed', rows, { order: 'native', base: NATIVE }, DISCORD),
    ).toEqual({});
  });

  it('does not show a fact the channel cannot show, even when the template for all channels lists it', () => {
    const rows = itemRows(
      'memberApproved',
      {
        items: {
          order: 'custom',
          list: [
            { id: 'login', enabled: true },
            { id: 'summary', enabled: true },
            { id: 'text:abc123', enabled: true, text: 'Hi' },
          ],
        },
      },
      DISCORD,
      ['summary', 'role'],
    );
    expect(rows.map((row) => [row.id, row.enabled])).toEqual([
      ['summary', true],
      ['text:abc123', true],
      ['role', false],
    ]);
  });
});

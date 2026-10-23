import { describe, expect, it } from 'vitest';
import { ITEMS, VARIABLES } from './catalog';
import { directoryKey, type MentionDirectory } from './mentions';
import {
  isOneEmoji,
  isSafeButtonUrl,
  TEMPLATE_LIMITS,
  validateTemplate,
  type TemplateScope,
} from './schema';
import type { TemplateType } from './types';

const DIRECTORY: MentionDirectory = {
  [directoryKey('discord', 'bureau')]: {
    platform: 'discord',
    kind: 'role',
    label: 'Bureau',
    externalId: '123456789012345678',
  },
  [directoryKey('slack', 'bureau')]: {
    platform: 'slack',
    kind: 'group',
    label: 'Bureau',
    externalId: 'S0614TZR7',
  },
  [directoryKey('slack', 'paula')]: {
    platform: 'slack',
    kind: 'user',
    label: 'Paula',
    externalId: 'U012AB3CDE',
  },
};

const check = (
  content: unknown,
  type: TemplateType = 'eventConfirmed',
  scope: TemplateScope = 'all',
) => validateTemplate(type, scope, content, DIRECTORY);
const issuesOf = (content: unknown, type?: TemplateType, scope?: TemplateScope) => {
  const result = check(content, type, scope);
  return result.ok ? [] : result.issues;
};
const codes = (content: unknown, type?: TemplateType, scope?: TemplateScope) =>
  issuesOf(content, type, scope).map((issue) => `${issue.path}:${issue.code}`);

describe('what a template may hold', () => {
  it('accepts a template that says nothing, and one that says everything it can', () => {
    expect(check({}).ok).toBe(true);
    const full = check({
      eyebrow: 'Party time',
      title: '{title} at {place}',
      emoji: '🎉',
      color: '#AABBCC',
      items: {
        order: 'custom',
        list: [
          { id: 'when', enabled: true, label: 'Quand', emoji: '🗓️' },
          { id: 'where', enabled: false },
          { id: 'text:ab12', enabled: true, text: 'Bring **a friend**' },
        ],
      },
      button: { enabled: true, label: 'Open', url: 'https://forms.example.fr/join' },
      above: '{@here} new event',
      footer: 'Made by {bde}',
      subject: '{title} on {date}',
      preheader: '{place}',
      note: 'See you',
    });
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.value.color).toBe('#aabbcc');
  });

  it('trims the texts, and refuses a text with nothing in it', () => {
    const ok = check({ title: '   {title}  ' });
    expect(ok.ok && ok.value.title).toBe('{title}');
    expect(codes({ title: '   ' })).toEqual(['title:required']);
    expect(codes({ eyebrow: '' })).toEqual(['eyebrow:required']);
  });

  it('refuses a field it does not know, and a value of the wrong kind', () => {
    expect(codes({ colour: '#fff' })).toEqual([':unknownField']);
    expect(codes({ title: 3 })).toEqual(['title:invalid']);
    expect(codes('title')).toEqual([':invalid']);
    expect(codes(null)).toEqual([':invalid']);
    expect(codes({ items: { order: 'random', list: [] } })).toEqual(['items.order:invalid']);
    expect(codes({ button: { color: 'red' } })).toEqual(['button:unknownField']);
  });

  it.each([
    ['eyebrow', TEMPLATE_LIMITS.eyebrow],
    ['title', TEMPLATE_LIMITS.title],
    ['footer', TEMPLATE_LIMITS.footer],
    ['preheader', TEMPLATE_LIMITS.preheader],
    ['subject', TEMPLATE_LIMITS.subject],
  ])('keeps %s within its limit', (field, limit) => {
    expect(check({ [field]: 'a'.repeat(limit) }).ok).toBe(true);
    expect(codes({ [field]: 'a'.repeat(limit + 1) })).toEqual([`${field}:tooLong`]);
  });

  it('keeps the note, the message above and the address within their limits', () => {
    expect(codes({ note: 'a'.repeat(TEMPLATE_LIMITS.note + 1) })).toEqual(['note:tooLong']);
    expect(codes({ above: 'a'.repeat(TEMPLATE_LIMITS.above + 1) }, undefined, 'discord')).toEqual([
      'above:tooLong',
    ]);
    expect(
      codes({ button: { url: `https://example.fr/${'a'.repeat(TEMPLATE_LIMITS.buttonUrl)}` } }),
    ).toEqual(['button.url:tooLong']);
  });

  it('counts a limit in characters, not in bytes: an emoji or an accent is one', () => {
    expect(check({ eyebrow: 'é'.repeat(TEMPLATE_LIMITS.eyebrow) }).ok).toBe(true);
  });

  it('only accepts a colour written as six hex digits', () => {
    expect(codes({ color: 'red' })).toEqual(['color:badColor']);
    expect(codes({ color: '#fff' })).toEqual(['color:badColor']);
    expect(codes({ color: '#12345g' })).toEqual(['color:badColor']);
    expect(codes({ color: 'red;background:url(x)' })).toEqual(['color:badColor']);
  });
});

describe('emojis', () => {
  it.each(['🎉', '🗓️', '👨‍👩‍👧', '🇫🇷', '1️⃣', '✅'])('%s is one emoji', (value) => {
    expect(isOneEmoji(value)).toBe(true);
  });

  it.each(['', 'a', '12', '🎉🎉', 'ab🎉', '<b>', ' ', '🎉 ', 'x'.repeat(30)])(
    '%j is not',
    (value) => {
      expect(isOneEmoji(value)).toBe(false);
    },
  );

  it('accepts none (an empty emoji takes it away) and refuses text where an emoji goes', () => {
    expect(check({ emoji: '' }).ok).toBe(true);
    expect(codes({ emoji: 'hello' })).toEqual(['emoji:notAnEmoji']);
    expect(
      codes({ items: { order: 'native', list: [{ id: 'when', enabled: true, emoji: '<img>' }] } }),
    ).toEqual(['items.list.0.emoji:notAnEmoji']);
  });
});

describe('variables', () => {
  it('accepts the variables of the type, in every text of the template', () => {
    expect(
      check({
        eyebrow: '{title}',
        title:
          '{date} {time} {end_time} {when} {place} {category} {assignees} {repeat} {description} {link} {bde}',
        footer: '{bde}',
        subject: '{title}',
        preheader: '{place}',
        note: '{place}',
        button: { label: '{title}' },
        items: { order: 'native', list: [{ id: 'when', enabled: true, label: '{title}' }] },
      }).ok,
    ).toBe(true);
  });

  it('refuses a variable the type does not offer, and says which and where', () => {
    const issues = issuesOf({
      title: '{author}',
      items: { order: 'native', list: [{ id: 'when', enabled: true, label: '{nope}' }] },
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: 'title', code: 'unknownVariable', params: { variable: 'author' } },
        { path: 'items.list.0.label', code: 'unknownVariable', params: { variable: 'nope' } },
      ]),
    );
  });

  it('offers each type only what it has: the reminder its day, the refusal its reason, a member his login', () => {
    expect(check({ title: '{day}' }, 'eventReminder').ok).toBe(true);
    expect(codes({ title: '{day}' }, 'eventConfirmed')).toEqual(['title:unknownVariable']);
    expect(check({ title: '{comment} {reviewer} {author}' }, 'eventRefused').ok).toBe(true);
    expect(codes({ title: '{comment}' }, 'eventApproved')).toEqual(['title:unknownVariable']);
    expect(check({ title: '{name} {login} {campus}' }, 'memberPending').ok).toBe(true);
    expect(codes({ title: '{role}' }, 'memberPending')).toEqual(['title:unknownVariable']);
    expect(codes({ title: '{title}' }, 'memberPending')).toEqual(['title:unknownVariable']);
  });

  it('accepts every variable of the catalog for its type', () => {
    for (const type of Object.keys(VARIABLES) as TemplateType[]) {
      const title = VARIABLES[type].map((id) => `{${id}}`).join(' ');
      expect(check({ title: title.slice(0, 190) }, type).ok).toBe(true);
    }
  });

  it('writes a brace with a doubled brace, which is not a variable', () => {
    expect(check({ title: '{{nope}}' }).ok).toBe(true);
  });
});

describe('items', () => {
  const list = (...items: Array<Record<string, unknown>>) => ({
    items: { order: 'native', list: items },
  });

  it('refuses a fact the type does not have, and one that appears twice', () => {
    expect(codes(list({ id: 'reason', enabled: true }))).toEqual(['items.list.0.id:unknownItem']);
    expect(codes(list({ id: 'login', enabled: true }))).toEqual(['items.list.0.id:unknownItem']);
    expect(codes(list({ id: 'when', enabled: true }, { id: 'when', enabled: false }))).toEqual([
      'items.list.1.id:duplicateItem',
    ]);
    expect(check(list({ id: 'reason', enabled: true }), 'eventRefused').ok).toBe(true);
  });

  it('accepts every fact of the catalog for its type', () => {
    for (const type of Object.keys(ITEMS) as TemplateType[]) {
      expect(check(list(...ITEMS[type].map((id) => ({ id, enabled: true }))), type).ok).toBe(true);
    }
  });

  it('wants a free text to say something, and names it with an id of its own', () => {
    expect(codes(list({ id: 'text:abc', enabled: true }))).toEqual(['items.list.0.text:required']);
    expect(check(list({ id: 'text:abc', enabled: true, text: 'Hi' })).ok).toBe(true);
    expect(codes(list({ id: 'text:ABC', enabled: true, text: 'Hi' }))).toEqual([
      'items.list.0.id:unknownItem',
    ]);
    expect(codes(list({ id: 'text:abc', enabled: true, text: 'Hi', label: 'Name' }))).toEqual([
      'items.list.0.label:textNotAllowed',
    ]);
  });

  it('lets only the summary of a member carry a sentence, besides the free texts', () => {
    expect(
      check(list({ id: 'summary', enabled: true, text: '{name} knocks' }), 'memberPending').ok,
    ).toBe(true);
    expect(codes(list({ id: 'when', enabled: true, text: 'x' }))).toEqual([
      'items.list.0.text:textNotAllowed',
    ]);
  });

  it('keeps the free texts and the list within their limits', () => {
    const many = Array.from({ length: TEMPLATE_LIMITS.freeTexts + 1 }, (_, i) => ({
      id: `text:t${i}`,
      enabled: true,
      text: 'x',
    }));
    expect(codes(list(...many))).toContain('items.list:tooManyTexts');
    const tooLong = Array.from({ length: TEMPLATE_LIMITS.items + 1 }, (_, i) => ({
      id: `text:t${i}`,
      enabled: false,
      text: 'x',
    }));
    expect(codes(list(...tooLong))).toContain('items.list:tooMany');
    expect(
      codes(list({ id: 'text:a', enabled: true, text: 'x'.repeat(TEMPLATE_LIMITS.freeText + 1) })),
    ).toEqual(['items.list.0.text:tooLong']);
  });

  it('refuses a variable it does not know in a free text, and a mention anywhere but above the card', () => {
    expect(codes(list({ id: 'text:a', enabled: true, text: '{nope}' }))).toEqual([
      'items.list.0.text:unknownVariable',
    ]);
    expect(codes(list({ id: 'text:a', enabled: true, text: '{@everyone}' }))).toEqual([
      'items.list.0.text:mentionNotAllowed',
    ]);
  });
});

describe('what only one channel has', () => {
  it('keeps the subject, the line after it and the note for e-mail', () => {
    for (const scope of ['discord', 'slack'] as const) {
      expect(codes({ subject: 'x' }, undefined, scope)).toEqual(['subject:emailOnly']);
      expect(codes({ preheader: 'x' }, undefined, scope)).toEqual(['preheader:emailOnly']);
      expect(codes({ note: 'x' }, undefined, scope)).toEqual(['note:emailOnly']);
    }
    expect(check({ subject: 'x', preheader: 'y', note: 'z' }, undefined, 'email').ok).toBe(true);
    expect(check({ subject: 'x' }, undefined, 'all').ok).toBe(true);
  });

  it('keeps the message above the card for the chats', () => {
    expect(codes({ above: '{@here}' }, undefined, 'email')).toEqual(['above:notForEmail']);
    expect(check({ above: '{@here}' }, undefined, 'discord').ok).toBe(true);
    expect(check({ above: '{@here}' }, undefined, 'all').ok).toBe(true);
  });
});

describe('mentions', () => {
  it('lets the template for all channels mention everyone and here, and nothing that needs an identifier', () => {
    expect(check({ above: '{@everyone} {@here}' }, undefined, 'all').ok).toBe(true);
    expect(codes({ above: '{@channel}' }, undefined, 'all')).toEqual([
      'above:mentionNotForChannel',
    ]);
    expect(codes({ above: '{@role:bureau}' }, undefined, 'all')).toEqual([
      'above:mentionNeedsChannel',
    ]);
    expect(codes({ above: '{@user:paula}' }, undefined, 'all')).toEqual([
      'above:mentionNeedsChannel',
    ]);
  });

  it('lets each channel mention what its platform has, by names the directory knows', () => {
    expect(check({ above: '{@role:bureau}' }, undefined, 'discord').ok).toBe(true);
    expect(
      check({ above: '{@channel} {@group:bureau} {@user:paula}' }, undefined, 'slack').ok,
    ).toBe(true);
    expect(codes({ above: '{@channel}' }, undefined, 'discord')).toEqual([
      'above:mentionNotForChannel',
    ]);
    expect(codes({ above: '{@group:bureau}' }, undefined, 'discord')).toEqual([
      'above:mentionNotForChannel',
    ]);
    expect(codes({ above: '{@role:bureau}' }, undefined, 'slack')).toEqual([
      'above:mentionNotForChannel',
    ]);
  });

  it('refuses a name the directory does not know, one of another kind, and one of the other platform', () => {
    expect(codes({ above: '{@role:nobody}' }, undefined, 'discord')).toEqual([
      'above:unknownMention',
    ]);
    expect(codes({ above: '{@user:bureau}' }, undefined, 'discord')).toEqual([
      'above:unknownMention',
    ]);
    expect(codes({ above: '{@user:paula}' }, undefined, 'discord')).toEqual([
      'above:unknownMention',
    ]);
  });

  it('refuses something that looks like a mention and is not one', () => {
    expect(codes({ above: '{@robot}' }, undefined, 'discord')).toEqual(['above:badMention']);
    expect(codes({ above: '{@role:Bad Key}' }, undefined, 'discord')).toEqual(['above:badMention']);
    expect(codes({ above: '{@}' }, undefined, 'discord')).toEqual(['above:badMention']);
  });

  it('refuses a mention in any other text of the template', () => {
    for (const field of ['eyebrow', 'title', 'footer', 'subject', 'preheader', 'note']) {
      const scope = ['subject', 'preheader', 'note'].includes(field) ? 'email' : 'discord';
      expect(codes({ [field]: 'hi {@everyone}' }, undefined, scope)).toContain(
        `${field}:mentionNotAllowed`,
      );
    }
    expect(codes({ button: { label: '{@here}' } })).toEqual(['button.label:mentionNotAllowed']);
  });

  it('says the variables of the message above must be the type’s', () => {
    expect(codes({ above: '{nope}' }, undefined, 'discord')).toEqual(['above:unknownVariable']);
    expect(check({ above: '{title} {@here}' }, undefined, 'discord').ok).toBe(true);
  });
});

describe('the address of the button', () => {
  it.each([
    'https://forms.example.fr/join',
    'https://example.fr/a?b=c#d',
    'https://sub.example.co.uk/',
  ])('accepts %s', (url) => {
    expect(isSafeButtonUrl(url)).toBe(true);
    expect(check({ button: { url } }).ok).toBe(true);
  });

  it.each([
    'http://example.fr',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'ftp://example.fr',
    '//example.fr',
    'example.fr',
    'https://user:pass@example.fr',
    'https://localhost',
    'https://',
    '',
    ' ',
    'mailto:a@b.fr',
  ])('refuses %j', (url) => {
    expect(isSafeButtonUrl(url)).toBe(false);
    expect(codes({ button: { url } })).toEqual(['button.url:badUrl']);
  });
});

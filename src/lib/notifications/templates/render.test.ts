import { beforeAll, describe, expect, it } from 'vitest';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import type { NotificationEventData, Translate } from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { buildMemberEmbed } from '@/lib/members/discord-embed';
import { buildApprovedEmail, buildPendingEmail } from '@/lib/members/email';
import type { MemberFacts } from '@/lib/members/messages';
import { buildMemberSlack } from '@/lib/members/slack-blocks';
import type { SlackBlock } from '../slack-blocks';
import { getNotificationTranslate } from '../translate';
import type { TemplateContent, TemplateContext, TemplateItem } from './types';

/**
 * What a template changes, in each channel. The default rendering is held by `golden.test.ts`; here, what the BDE writes
 * comes out where it should, and only what it writes.
 */

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-08T12:00:00Z');
const BRAND = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png', accent: '#2f5bea' };

const EVENT: NotificationEventData = {
  eventId: 'e1',
  title: 'Soirée de rentrée',
  description: 'DJ set et buffet.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula', 'Sam'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  repeat: 'Every week',
  url: 'https://bde.example.fr/en/events/e1',
};
const REVIEWED: NotificationEventData = {
  ...EVENT,
  review: { authorName: 'Camille', reviewerName: 'Paula', comment: 'Already booked.' },
};
const MEMBER: MemberFacts = {
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
  roleName: 'Treasurer',
  actorName: 'Paula Martin',
};
const MEMBERS_URL = 'https://bde.example.fr/en/members';

let te: Translate;
let tm: Translate;
beforeAll(async () => {
  te = await getNotificationTranslate('en', 'events.notifications');
  tm = await getNotificationTranslate('en', 'members.notifications');
});

const on = (id: TemplateItem['id'], more: Partial<TemplateItem> = {}): TemplateItem => ({
  id,
  enabled: true,
  ...more,
});
const ctx = (template: TemplateContent): TemplateContext => ({
  template,
  bdeName: 'BDE Nice',
  locale: 'en',
});
const items = (order: 'native' | 'custom', ...list: TemplateItem[]): TemplateContent => ({
  items: { order, list },
});

const embed = (
  template: TemplateContent,
  data = EVENT,
  kind: 'confirmed' | 'refused' = 'confirmed',
) => buildEventEmbed(kind, data, te, TZ, NOW, ctx(template));
const slack = (
  template: TemplateContent,
  data = EVENT,
  kind: 'confirmed' | 'refused' = 'confirmed',
) => buildEventSlack(kind, data, te, 'en', TZ, BRAND, ctx(template));
const email = (
  template: TemplateContent,
  data = EVENT,
  kind: 'confirmed' | 'refused' = 'confirmed',
) => buildEventEmail(kind, data, te, 'en', TZ, BRAND, undefined, ctx(template));

const fieldNames = (card: ReturnType<typeof embed>) => (card.fields ?? []).map((f) => f.name);
const columnLabels = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) =>
    block.type === 'section' && block.fields
      ? block.fields.map((field) => /^\*([^*]*)\*/.exec(field.text)?.[1])
      : [],
  );
const sectionTexts = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) => (block.type === 'section' && block.text ? [block.text.text] : []));

describe('the Discord card of an event', () => {
  it('writes the BDE’s eyebrow, title, emoji, footer and colour', () => {
    const card = embed({
      eyebrow: 'Party time',
      title: '{title} — {place}',
      emoji: '🥳',
      footer: 'Made by {bde}',
      color: '#00ff00',
    });
    expect(card.title).toBe('🥳  Soirée de rentrée — Foyer du campus');
    expect(card.description).toContain('-# PARTY TIME');
    expect(card.footer?.text).toBe('Made by BDE Nice');
    expect(card.color).toBe(0x00ff00);
  });

  it('writes no emoji, and no stray space, when the BDE took it away', () => {
    expect(embed({ emoji: '' }).title).toBe('Soirée de rentrée');
  });

  it('puts what the variables stand for in as text, never read as a variable or a mention', () => {
    const card = embed(
      { title: '{title}', footer: '{place}' },
      { ...EVENT, title: '{place} @everyone <@123>', location: 'X' },
    );
    expect(card.title).toBe('🎉  {place} @everyone <@123>');
    expect(card.footer?.text).toBe('X');
  });

  it('shows the dates and the other variables in the language of the BDE', () => {
    const card = embed({ title: '{date} · {time}–{end_time} · {when}' });
    expect(card.title).toBe(
      '🎉  Saturday, October 10, 2026 · 8:00 PM–11:30 PM · Saturday, October 10, 2026 at 8:00 PM → 11:30 PM',
    );
  });

  it('hides the facts that are switched off and writes the labels and emoji of the others', () => {
    const card = embed(
      items(
        'native',
        on('when'),
        on('category', { label: 'Genre', emoji: '🎭' }),
        { id: 'assignees', enabled: false },
        on('where'),
      ),
    );
    expect(fieldNames(card)).toEqual(['🎭  Genre']);
    expect(card.description).toContain('Foyer du campus');
    expect(card.description).not.toContain('DJ set');
  });

  it('puts the facts in the BDE’s order, the headings and the fields each in theirs', () => {
    const card = embed(
      items('custom', on('assignees'), on('category'), on('where'), on('when'), on('repeats')),
    );
    expect(fieldNames(card)).toEqual(['👥  Members in charge', '🏷️  Category', '🔁  Repeats']);
    const text = card.description ?? '';
    expect(text.indexOf('Foyer du campus')).toBeLessThan(text.indexOf('<t:'));
  });

  it('writes a free text with its formatting, where the BDE put it', () => {
    const card = embed(
      items(
        'custom',
        on('when'),
        on('text:a', { text: 'Bring **a friend** to {place}!' }),
        on('where'),
      ),
    );
    const text = card.description ?? '';
    expect(text).toContain('Bring **a friend** to Foyer du campus!');
    expect(text.indexOf('Bring')).toBeGreaterThan(text.indexOf('<t:'));
    expect(text.indexOf('Bring')).toBeLessThan(text.indexOf('### 📍'));
  });

  it('adds a link line when the BDE asks for a button, with its label', () => {
    const card = embed({ button: { enabled: true, label: 'Go to {title}' } });
    expect(card.description).toContain(
      '👉  [Go to Soirée de rentrée](https://bde.example.fr/en/events/e1)',
    );
    expect(embed({}).description).not.toContain('👉');
  });

  it('shows the reason of a refusal under the BDE’s label', () => {
    const card = embed(
      items('native', on('reason', { label: 'Why not' }), on('when')),
      REVIEWED,
      'refused',
    );
    expect(card.description).toContain('### 💬  Why not');
    expect(card.description).toContain('> Already booked.');
  });
});

describe('the Slack message of an event', () => {
  it('writes the BDE’s eyebrow, title, emoji, footer and colour, and the summary says them', () => {
    const message = slack({
      eyebrow: 'Party time',
      title: '{title}!',
      emoji: '🥳',
      footer: 'Made by {bde}',
      color: '#00ff00',
    });
    expect(message.blocks[0]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Party time*' }],
    });
    expect(message.blocks[1]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: '🥳  Soirée de rentrée!' },
    });
    const footer = message.blocks[message.blocks.length - 1];
    expect(footer).toMatchObject({
      type: 'context',
      elements: [{ type: 'image' }, { type: 'mrkdwn', text: 'Made by BDE Nice' }],
    });
    expect(message.color).toBe('#00ff00');
    expect(message.fallback).toContain('Party time : Soirée de rentrée!');
  });

  it('puts the description and the date at the top, and the other facts in the columns, each in the BDE’s order', () => {
    const message = slack(
      items('custom', on('assignees'), on('category'), on('when'), on('where'), on('description')),
    );
    expect(columnLabels(message.blocks)).toEqual(['Members in charge', 'Category', 'Where']);
    const top = sectionTexts(message.blocks);
    expect(top[0]).toContain('*When*');
    expect(top[1]).toBe('DJ set et buffet.');
  });

  it('hides the facts switched off, and writes labels with their emoji', () => {
    const message = slack(
      items(
        'native',
        on('when', { label: 'Quand', emoji: '🗓️' }),
        on('category', { label: 'Genre' }),
      ),
    );
    expect(sectionTexts(message.blocks)[0]).toContain('*🗓️ Quand*');
    expect(columnLabels(message.blocks)).toEqual(['Genre']);
  });

  it('writes a free text as its own section, with Slack’s own markup for bold and italic', () => {
    const message = slack(items('native', on('when'), on('text:a', { text: '**Free** _entry_' })));
    expect(sectionTexts(message.blocks)).toContain('*Free* _entry_');
  });

  it('changes the button’s label, or takes the button away', () => {
    const labelled = slack({ button: { label: 'Open {title}' } });
    expect(JSON.stringify(labelled.blocks)).toContain('"text":"Open Soirée de rentrée"');
    const without = slack({ button: { enabled: false } });
    expect(without.blocks.some((block) => block.type === 'actions')).toBe(false);
  });

  it('leaves out a section that would be empty', () => {
    const message = slack(items('native', on('when')));
    expect(message.blocks.some((block) => block.type === 'section' && block.fields)).toBe(false);
  });
});

describe('the e-mail of an event', () => {
  it('writes the subject, the line after it, the headings, the note and the footer of the BDE', () => {
    const mail = email({
      subject: '[{bde}] {title} on {date}',
      preheader: '{place} at {time}',
      eyebrow: 'Party time',
      title: '{title}!',
      note: 'See you there, {place}',
      footer: 'Sent by {bde}',
    });
    expect(mail.subject).toBe('[BDE Nice] Soirée de rentrée on Saturday, October 10, 2026');
    expect(mail.html).toContain('Foyer du campus at 8:00 PM&#847;');
    expect(mail.html).toContain('>Soirée de rentrée!</h1>');
    expect(mail.html).toContain('Party time');
    expect(mail.html).toContain('See you there, Foyer du campus');
    expect(mail.html).toContain('Sent by BDE Nice');
    expect(mail.text).toContain('Party time'.toUpperCase());
  });

  it('has no subject of its own without a template, so the plain message’s stays', () => {
    expect(email({}).subject).toBeUndefined();
  });

  it('puts the colour the BDE chose on the bar', () => {
    expect(email({ color: '#00ff00' }).html).toContain('<td bgcolor="#00ff00" height="6"');
  });

  it('lists the facts in the BDE’s order with their labels and emoji, and hides the ones switched off', () => {
    const mail = email(
      items('custom', on('category', { label: 'Genre', emoji: '🎭' }), on('when'), {
        id: 'where',
        enabled: false,
      }),
    );
    const rows = mail.text
      .split('\n')
      .filter((line) => / : /.test(line) && !line.startsWith('View'));
    expect(rows.map((row) => row.split(' : ')[0])).toEqual(['🎭 Genre', 'When']);
  });

  it('uses the reason as the lead of a refusal, or the description when the reason is off', () => {
    expect(
      email(items('native', on('reason'), on('description')), REVIEWED, 'refused').text,
    ).toContain('Reason :\nAlready booked.');
    const mail = email(items('native', on('description')), REVIEWED, 'refused');
    expect(mail.text).toContain('DJ set et buffet.');
    expect(mail.text).not.toContain('Already booked.');
  });

  it('writes a free text as a paragraph, with bold and italic, safely', () => {
    const mail = email(
      items('native', on('when'), on('text:a', { text: '**Free** <b>entry</b> for _{title}_' })),
      { ...EVENT, title: '<script>alert(1)</script>' },
    );
    expect(mail.html).toContain(
      '<strong>Free</strong> &lt;b&gt;entry&lt;/b&gt; for <em>&lt;script&gt;alert(1)&lt;/script&gt;</em>',
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('Free <b>entry</b> for <script>alert(1)</script>');
  });

  it('changes the button’s label, or takes the button away', () => {
    expect(email({ button: { label: 'Open it' } }).html).toContain('>Open it</a>');
    const without = email({ button: { enabled: false } });
    expect(without.html).not.toContain('class="btn"');
    expect(without.text).not.toContain('https://bde.example.fr/en/events/e1');
  });

  it('escapes every text of the template and of the data', () => {
    const mail = email(
      { title: '{title} <i>x</i>', footer: '"quoted" & <b>', subject: '<s>{title}</s>' },
      { ...EVENT, title: '</h1><img src=x onerror=alert(1)>' },
    );
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<i>x</i>');
    expect(mail.html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
    // a subject is plain text for the mail client, not HTML
    expect(mail.subject).toBe('<s></h1><img src=x onerror=alert(1)></s>');
  });
});

describe('the cards of a member', () => {
  it('Discord: the BDE’s texts, colour, facts and link', () => {
    const card = buildMemberEmbed(
      'pending',
      MEMBER,
      tm,
      MEMBERS_URL,
      NOW,
      ctx({
        eyebrow: 'Someone knocks',
        title: '{name} ({login})',
        emoji: '',
        color: '#112233',
        footer: '{bde}',
        button: { label: 'Decide' },
        ...items('custom', on('summary', { text: '{name} wants in, from {campus}' }), on('login')),
      }),
    );
    expect(card.title).toBe('Camille Martin (cmartin)');
    expect(card.description).toContain('-# SOMEONE KNOCKS');
    expect(card.description).toContain('> Camille Martin wants in, from Nice');
    expect(card.description).toContain('### 🪪  cmartin');
    expect(card.description).toContain('[Decide](https://bde.example.fr/en/members)');
    expect(card.color).toBe(0x112233);
    expect(card.footer?.text).toBe('BDE Nice');
    expect(card.description).not.toContain('🏫');
  });

  it('Discord: no link for a request when the BDE took the button away, a link for an approval when it asks', () => {
    expect(
      buildMemberEmbed('pending', MEMBER, tm, MEMBERS_URL, NOW, ctx({ button: { enabled: false } }))
        .description,
    ).not.toContain('👉');
    expect(
      buildMemberEmbed('approved', MEMBER, tm, MEMBERS_URL, NOW, ctx({ button: { enabled: true } }))
        .description,
    ).toContain('[View the members](https://bde.example.fr/en/members)');
  });

  it('Discord: who did it and the role are fields the BDE can rename', () => {
    const card = buildMemberEmbed(
      'approved',
      MEMBER,
      tm,
      MEMBERS_URL,
      NOW,
      ctx(
        items(
          'native',
          on('role', { label: 'Post' }),
          on('actedBy', { label: 'Thanks to', emoji: '🙏' }),
        ),
      ),
    );
    expect(fieldNames(card)).toEqual(['🎭  Post', '🙏  Thanks to']);
  });

  it('Slack: the BDE’s texts, facts and button', () => {
    const message = buildMemberSlack(
      'approved',
      MEMBER,
      tm,
      MEMBERS_URL,
      BRAND,
      ctx({
        title: 'Welcome {name}',
        button: { enabled: true, label: 'See the team' },
        ...items(
          'custom',
          on('role', { label: 'Post' }),
          on('summary', { text: 'Joined as {role}' }),
        ),
      }),
    );
    expect(message.blocks[1]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Welcome Camille Martin' },
    });
    expect(sectionTexts(message.blocks)).toContain('Joined as Treasurer');
    expect(columnLabels(message.blocks)).toEqual(['Post']);
    expect(JSON.stringify(message.blocks)).toContain('"text":"See the team"');
  });

  it('e-mail to the people who approve: subject, texts, facts and button', () => {
    const mail = buildPendingEmail(
      MEMBER,
      tm,
      MEMBERS_URL,
      BRAND,
      'en',
      ctx({
        subject: '{name} asks to join {bde}',
        title: '{name}?',
        button: { label: 'Answer' },
        note: 'Please answer fast',
        ...items(
          'native',
          on('summary', { text: '{login} from {campus}' }),
          on('login', { label: 'Id' }),
        ),
      }),
    );
    expect(mail.subject).toBe('Camille Martin asks to join BDE Nice');
    expect(mail.html).toContain('>Camille Martin?</h1>');
    expect(mail.text).toContain('cmartin from Nice');
    expect(mail.text).toContain('Id : cmartin');
    expect(mail.text).not.toContain('Campus');
    expect(mail.html).toContain('>Answer</a>');
    expect(mail.html).toContain('Please answer fast');
  });

  it('e-mail to the approved member: its own subject and heading, apart from each other', () => {
    const plain = buildApprovedEmail(MEMBER, 'Treasurer', tm, MEMBERS_URL, BRAND, 'en');
    const custom = buildApprovedEmail(
      MEMBER,
      'Treasurer',
      tm,
      MEMBERS_URL,
      BRAND,
      'en',
      ctx({ subject: 'Welcome aboard, {name}' }),
    );
    expect(custom.subject).toBe('Welcome aboard, Camille Martin');
    // only the subject changed: the heading is still the platform's
    expect(custom.html).toContain(`>${plain.subject}</h1>`);
    const retitled = buildApprovedEmail(
      MEMBER,
      'Treasurer',
      tm,
      MEMBERS_URL,
      BRAND,
      'en',
      ctx({ title: 'Hi {name}' }),
    );
    expect(retitled.subject).toBe(plain.subject);
    expect(retitled.html).toContain('>Hi Camille Martin</h1>');
  });
});

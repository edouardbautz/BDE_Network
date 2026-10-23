import { beforeAll, describe, expect, it } from 'vitest';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import type { NotificationEventData, Translate } from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { eventAbove } from '@/lib/events/template-values';
import { buildMemberEmbed } from '@/lib/members/discord-embed';
import { buildApprovedEmail, buildPendingEmail } from '@/lib/members/email';
import type { MemberFacts } from '@/lib/members/messages';
import { buildMemberSlack } from '@/lib/members/slack-blocks';
import { memberAbove } from '@/lib/members/template-values';
import { getNotificationTranslate } from '../translate';
import { directoryKey, type MentionDirectory } from './mentions';
import type { TemplateContent, TemplateContext } from './types';

/**
 * What reaches other people from a template: where the button leads, and the message above the card (the one place a mention is
 * read). Each channel, events and members.
 */

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-08T12:00:00Z');
const BRAND = { name: 'BDE Nice', accent: '#2f5bea' };
const FORM = 'https://forms.example.fr/join?x=1';

const EVENT: NotificationEventData = {
  eventId: 'e1',
  title: 'Soirée',
  description: null,
  location: null,
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: [],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  repeat: null,
  url: 'https://bde.example.fr/en/events/e1',
};
const MEMBER: MemberFacts = { login: 'cmartin', fullName: 'Camille Martin', campus: 'Nice' };
const MEMBERS_URL = 'https://bde.example.fr/en/members';

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
};

let te: Translate;
let tm: Translate;
beforeAll(async () => {
  te = await getNotificationTranslate('en', 'events.notifications');
  tm = await getNotificationTranslate('en', 'members.notifications');
});

const ctx = (template: TemplateContent): TemplateContext => ({
  template,
  bdeName: 'BDE Nice',
  locale: 'en',
  mentions: DIRECTORY,
});
const BUTTON: TemplateContent = { button: { enabled: true, url: FORM } };

describe('where the button leads', () => {
  it('Slack and e-mail: to the address the BDE chose, instead of the page of the event', () => {
    const slack = buildEventSlack('confirmed', EVENT, te, 'en', TZ, BRAND, ctx(BUTTON));
    expect(JSON.stringify(slack.blocks)).toContain(FORM);
    expect(JSON.stringify(slack.blocks)).not.toContain('events/e1');
    const mail = buildEventEmail('confirmed', EVENT, te, 'en', TZ, BRAND, undefined, ctx(BUTTON));
    expect(mail.html).toContain(`href="${FORM}"`.replaceAll('&', '&amp;'));
    expect(mail.html).not.toContain('events/e1?');
    expect(mail.text).toContain(FORM);
  });

  it('shows a button even when the platform has no address of its own, if the BDE gave one', () => {
    const data = { ...EVENT, url: null };
    expect(
      JSON.stringify(buildEventSlack('confirmed', data, te, 'en', TZ, BRAND, ctx(BUTTON)).blocks),
    ).toContain(FORM);
    expect(
      buildEventEmail('confirmed', data, te, 'en', TZ, BRAND, undefined, ctx(BUTTON)).html,
    ).toContain('class="btn"');
  });

  it('the title of a card keeps leading to the event, and a Discord link line leads to the chosen address', () => {
    const card = buildEventEmbed('confirmed', EVENT, te, TZ, NOW, ctx(BUTTON));
    expect(card.url).toBe('https://bde.example.fr/en/events/e1');
    expect(card.description).toContain(`[${te('slack.action')}](${FORM})`);
  });

  it('members: the same, for the request, the approval and the e-mails', () => {
    const slack = buildMemberSlack('pending', MEMBER, tm, MEMBERS_URL, BRAND, ctx(BUTTON));
    expect(JSON.stringify(slack.blocks)).toContain(FORM);
    expect(JSON.stringify(slack.blocks)).not.toContain('/members');
    const card = buildMemberEmbed('pending', MEMBER, tm, MEMBERS_URL, NOW, ctx(BUTTON));
    expect(card.description).toContain(`(${FORM})`);
    expect(card.url).toBe(MEMBERS_URL);
    expect(buildPendingEmail(MEMBER, tm, MEMBERS_URL, BRAND, 'en', ctx(BUTTON)).html).toContain(
      'forms.example.fr/join?x=1',
    );
    expect(
      buildApprovedEmail(MEMBER, 'Treasurer', tm, MEMBERS_URL, BRAND, 'en', ctx(BUTTON)).html,
    ).toContain('forms.example.fr/join?x=1');
  });

  it('with the button switched off, the address leads nowhere', () => {
    const off: TemplateContent = { button: { enabled: false, url: FORM } };
    expect(
      JSON.stringify(buildEventSlack('confirmed', EVENT, te, 'en', TZ, BRAND, ctx(off)).blocks),
    ).not.toContain(FORM);
    expect(
      buildEventEmail('confirmed', EVENT, te, 'en', TZ, BRAND, undefined, ctx(off)).html,
    ).not.toContain('forms.example.fr');
  });
});

describe('the message above the card', () => {
  const above: TemplateContent = { above: '{@role:bureau} {@here} {title}' };
  const slackAbove: TemplateContent = { above: '{@group:bureau} {@channel} {title}' };

  it('is nothing without a template that asks for it', () => {
    expect(eventAbove('discord', 'confirmed', EVENT, te, 'en', TZ, ctx({}))).toBeUndefined();
    expect(buildEventSlack('confirmed', EVENT, te, 'en', TZ, BRAND, ctx({})).above).toBeUndefined();
  });

  it('events on Discord: the mentions of the template and the title of the event, defused', () => {
    const result = eventAbove(
      'discord',
      'confirmed',
      { ...EVENT, title: '@everyone <@7>' },
      te,
      'en',
      TZ,
      ctx(above),
    );
    expect(result?.text.startsWith('<@&123456789012345678> @here ')).toBe(true);
    expect(result?.text).not.toContain('@everyone');
    expect(result?.mentions).toEqual({ everyone: true, roles: ['123456789012345678'], users: [] });
  });

  it('events on Slack: part of the message, with Slack’s own markup', () => {
    const message = buildEventSlack('confirmed', EVENT, te, 'en', TZ, BRAND, ctx(slackAbove));
    expect(message.above).toBe('<!subteam^S0614TZR7> <!channel> Soirée');
  });

  it('members: the same on both platforms', () => {
    expect(
      memberAbove('discord', MEMBER, MEMBERS_URL, ctx({ above: '{@here} {name} asks' }))?.text,
    ).toBe('@here Camille Martin asks');
    expect(
      buildMemberSlack(
        'pending',
        MEMBER,
        tm,
        MEMBERS_URL,
        BRAND,
        ctx({ above: '{@channel} {login}' }),
      ).above,
    ).toBe('<!channel> cmartin');
    expect(memberAbove('discord', MEMBER, null, ctx({}))).toBeUndefined();
  });

  it('is not part of an e-mail, which has no such place', () => {
    const mail = buildEventEmail('confirmed', EVENT, te, 'en', TZ, BRAND, undefined, ctx(above));
    expect(mail.html).not.toContain('@here');
    expect(mail.text).not.toContain('@here');
  });
});

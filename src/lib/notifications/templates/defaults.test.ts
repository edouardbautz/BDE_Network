import { describe, expect, it } from 'vitest';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import {
  buildConfirmationMessage,
  buildReminderMessage,
  buildReviewMessage,
  type NotificationEventData,
} from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { eventValues } from '@/lib/events/template-values';
import { buildMemberEmbed } from '@/lib/members/discord-embed';
import { buildApprovedEmail, buildPendingEmail } from '@/lib/members/email';
import {
  buildApprovedMessage,
  buildPendingMessage,
  type MemberFacts,
} from '@/lib/members/messages';
import { buildMemberSlack } from '@/lib/members/slack-blocks';
import { memberValues } from '@/lib/members/template-values';
import { escapeHtml } from '../email-layout';
import type { SlackBlock } from '../slack-blocks';
import { getNotificationTranslate } from '../translate';
import { channelsOfType, ITEMS } from './catalog';
import { describeDefaults } from './defaults';
import type { ChannelDefaults } from './defaults-shape';
import { EVENT_KIND_OF } from './kinds';
import { sampleEvent, sampleMember } from './samples';
import { renderPlain } from './text';
import { TEMPLATE_CHANNELS, type TemplateType } from './types';

/**
 * The patterns the editor shows for what the platform says are exactly what the platform sends: each pattern, with the values of an
 * example, is compared with the text the builders write by themselves. A message reworded in the catalog without its pattern moving
 * (or the reverse) is found here.
 */

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-08T12:00:00Z');
const BRAND = { name: 'BDE Nice', accent: '#2f5bea' };
const TYPES = Object.keys(ITEMS) as TemplateType[];
const EVENT_TYPES = TYPES.filter((type) => type in EVENT_KIND_OF);

/** The facts each type shows under its own name: as fields of a Discord card, in a Slack message and in an e-mail. */
type Fact = keyof ChannelDefaults['items'];
const FACTS: Record<string, { discord: Fact[]; slack: Fact[]; mail: Fact[] }> = {
  events: {
    discord: ['category', 'assignees', 'repeats'],
    slack: ['when', 'where', 'category', 'assignees', 'repeats'],
    mail: ['when', 'where', 'category', 'assignees', 'repeats'],
  },
  intraRequested: {
    discord: ['intraFields', 'requestedBy', 'repeats'],
    slack: ['when', 'where', 'repeats', 'intraFields', 'requestedBy'],
    mail: ['when', 'where', 'repeats', 'requestedBy'],
  },
  intraChanged: {
    discord: ['actedBy', 'repeats'],
    slack: ['changes', 'when', 'where', 'repeats', 'actedBy'],
    mail: ['changes', 'when', 'where', 'repeats', 'actedBy'],
  },
  intraCancelled: {
    discord: ['actedBy', 'repeats'],
    slack: ['reason', 'when', 'where', 'repeats', 'actedBy'],
    mail: ['reason', 'when', 'where', 'repeats', 'actedBy'],
  },
  intraPublished: {
    discord: ['intraLink', 'actedBy', 'repeats'],
    slack: ['when', 'where', 'repeats', 'intraLink', 'actedBy'],
    mail: ['when', 'where', 'repeats', 'intraLink', 'actedBy'],
  },
  intraRefused: {
    discord: ['actedBy', 'repeats'],
    slack: ['reason', 'when', 'where', 'repeats', 'actedBy'],
    mail: ['reason', 'when', 'where', 'repeats', 'actedBy'],
  },
};

const buttonOf = (blocks: SlackBlock[]) => {
  const actions = blocks.find((block) => block.type === 'actions');
  return actions?.type === 'actions' ? actions.elements[0]?.text.text : undefined;
};

describe.each(['fr', 'en'] as const)('what the platform says by itself (%s)', (locale) => {
  const url = (path: string) => `https://bde.example.fr/${locale}${path}`;

  describe('events', () => {
    it.each(EVENT_TYPES)('%s: the words of each channel are the patterns', async (type) => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const kind = EVENT_KIND_OF[type]!;
      const data: NotificationEventData = {
        ...sampleEvent(locale, NOW, type, t, TZ),
        url: url('/events/e1'),
      };
      const values = eventValues(kind, data, t, locale, TZ, 'BDE Nice');
      const say = (pattern: string, day: 'tomorrow' | 'today' = 'tomorrow') =>
        renderPlain(pattern, { ...values, day: t(`embed.day.${day}`) });

      const discord = await describeDefaults(type, 'discord', locale);
      const slack = await describeDefaults(type, 'slack', locale);
      const email = await describeDefaults(type, 'email', locale);
      const card = buildEventEmbed(kind, data, t, TZ, NOW);
      const message = buildEventSlack(kind, data, t, locale, TZ, BRAND);
      const mail = buildEventEmail(kind, data, t, locale, TZ, BRAND, {
        filename: 'e.ics',
        content: 'BEGIN:VCALENDAR',
      });

      // the small line above the title
      for (const defaults of [discord, slack, email]) {
        if (type !== 'eventReminder') expect(say(defaults.eyebrow)).toBe(t(`embed.kind.${kind}`));
      }
      expect(card.description).toContain(`-# ${say(discord.eyebrow).toUpperCase()}`);
      expect(message.blocks[0]).toMatchObject({
        elements: [{ text: `*${say(slack.eyebrow)}*` }],
      });
      expect(mail.html).toContain(escapeHtml(`${say(email.eyebrow)}`));

      // the title, and the emoji of a Discord card
      expect(card.title).toBe(`${discord.emoji}  ${say(discord.title)}`);
      expect(slack.emoji).toBe('');
      expect(email.emoji).toBe('');
      expect(mail.html).toContain(escapeHtml(`${say(email.title)}`));

      // the footer
      expect(card.footer?.text).toBe(say(discord.footer));
      expect(JSON.stringify(message.blocks.at(-1))).toContain(say(slack.footer));
      expect(mail.html).toContain(escapeHtml(say(email.footer)));

      // the button
      expect(discord.button.native).toBe(false);
      expect(slack.button.native && email.button.native).toBe(true);
      expect(buttonOf(message.blocks)).toBe(say(slack.button.label));
      expect(mail.html).toContain(escapeHtml(`${say(email.button.label)}`));
      expect(
        buildEventEmbed(kind, data, t, TZ, NOW, { template: { button: { enabled: true } } })
          .description,
      ).toContain(`[${say(discord.button.label)}](`);

      // what an e-mail has of its own
      expect(email.subject).toBeTruthy();
      expect(discord.subject).toBeUndefined();
      expect(slack.subject).toBeUndefined();
      if (type === 'eventConfirmed') {
        expect(mail.html).toContain(escapeHtml(email.note ?? ''));
        expect(say(email.subject!)).toBe(buildConfirmationMessage(data, t, locale, TZ).subject);
      } else {
        expect(email.note).toBeUndefined();
      }
      if (type === 'eventReminder') {
        for (const day of ['tomorrow', 'today'] as const) {
          expect(say(email.subject!, day)).toBe(
            buildReminderMessage(data, t, locale, TZ, day).subject,
          );
          expect(say(discord.eyebrow, day)).toBe(
            t(day === 'today' ? 'embed.kind.reminderToday' : 'embed.kind.reminderTomorrow'),
          );
        }
      }
      if (type === 'eventProposed' || type === 'eventApproved' || type === 'eventRefused') {
        const review = type.slice(5).toLowerCase() as 'proposed' | 'approved' | 'refused';
        expect(say(email.subject!)).toBe(buildReviewMessage(review, data, t, locale, TZ).subject);
      }

      // the name of each fact, and the emoji Discord puts in front of it
      const names = Object.fromEntries(
        (card.fields ?? []).map((field) => [field.name.replace(/^\S+\s{2}/, ''), field.name]),
      );
      const shown = (id: keyof typeof discord.items, channelItems = discord.items) =>
        channelItems[id]?.label;
      const facts = FACTS[type] ?? FACTS.events!;
      expect(Object.keys(names)).toEqual(
        expect.arrayContaining(facts.discord.map((id) => shown(id) as string)),
      );
      for (const id of facts.discord) {
        expect(card.fields?.map((field) => field.name)).toContain(
          `${discord.items[id]?.emoji}  ${discord.items[id]?.label}`,
        );
      }
      for (const id of facts.slack) {
        expect(JSON.stringify(message.blocks)).toContain(`*${slack.items[id]?.label}*`);
        expect(slack.items[id]?.emoji).toBeUndefined();
      }
      for (const id of facts.mail) {
        expect(mail.text).toContain(`${email.items[id]?.label} :`);
        expect(email.items[id]?.emoji).toBeUndefined();
      }
    });
  });

  describe('members', () => {
    const member: MemberFacts = { ...sampleMember(locale), photoUrl: null };

    it.each(['memberPending', 'memberApproved', 'memberRemoved'] as const)(
      '%s: the words of each channel are the patterns',
      async (type) => {
        const t = await getNotificationTranslate(locale, 'members.notifications');
        const kind =
          type === 'memberPending' ? 'pending' : type === 'memberApproved' ? 'approved' : 'removed';
        const values = memberValues(member, 'BDE Nice', url('/members'));
        const say = (pattern: string) => renderPlain(pattern, values);
        const link = kind === 'removed' ? null : url('/members');

        for (const channel of channelsOfType(type)) {
          const defaults = await describeDefaults(type, channel, locale);
          expect(say(defaults.eyebrow)).toBe(t(`embed.kind.${kind}`));
          if (channel === 'discord') {
            const card = buildMemberEmbed(kind, member, t, link, NOW);
            expect(card.title).toBe(`${defaults.emoji}  ${say(defaults.title)}`);
            expect(card.footer?.text).toBe(say(defaults.footer));
            expect(card.description).toContain(`-# ${say(defaults.eyebrow).toUpperCase()}`);
            expect(say(defaults.items.summary!.text!)).toBe(
              t(`embed.description.${kind}`, { name: member.fullName }),
            );
            if (kind === 'pending') {
              expect(card.description).toContain(`[${say(defaults.button.label)}](`);
            }
            expect(
              buildMemberEmbed(kind, member, t, url('/members'), NOW, {
                template: { button: { enabled: true } },
              }).description,
            ).toContain(`[${say(defaults.button.label)}](`);
            for (const id of ['role', 'actedBy'] as const) {
              if (kind === 'pending') continue;
              expect(card.fields?.map((field) => field.name)).toContain(
                `${defaults.items[id]?.emoji}  ${defaults.items[id]?.label}`,
              );
            }
          } else if (channel === 'slack') {
            const message = buildMemberSlack(kind, member, t, link, BRAND);
            expect(JSON.stringify(message.blocks.at(-1))).toContain(say(defaults.footer));
            expect(message.blocks[0]).toMatchObject({
              elements: [{ text: `*${say(defaults.eyebrow)}*` }],
            });
            if (kind === 'pending')
              expect(buttonOf(message.blocks)).toBe(say(defaults.button.label));
            expect(defaults.emoji).toBe('');
          } else {
            const mail =
              type === 'memberApproved'
                ? buildApprovedEmail(member, member.roleName ?? '', t, url(''), BRAND, locale)
                : buildPendingEmail(member, t, link, BRAND, locale);
            expect(mail.html).toContain(escapeHtml(say(defaults.footer)));
            expect(mail.html).toContain(escapeHtml(`${say(defaults.title)}`));
            expect(mail.html).toContain(escapeHtml(`${say(defaults.button.label)}`));
            const plainSubject =
              type === 'memberApproved'
                ? buildApprovedEmail(member, member.roleName ?? '', t, null, BRAND, locale).subject
                : buildPendingMessage(member, t, null).subject;
            expect(say(defaults.subject!)).toBe(plainSubject);
            expect(say(defaults.items.summary!.text!)).toBe(
              type === 'memberApproved'
                ? t('approved.memberIntro', { name: member.fullName })
                : t('embed.description.pending', { name: member.fullName }),
            );
          }
        }
        // the team's sentence of an approval
        if (type === 'memberApproved') {
          expect(buildApprovedMessage(member, member.roleName ?? '', t).subject).toBeTruthy();
        }
      },
    );
  });

  it('names a default for every channel and type, and none for the e-mail nobody sends', async () => {
    for (const type of TYPES) {
      for (const channel of TEMPLATE_CHANNELS) {
        if (!channelsOfType(type).includes(channel)) continue;
        const defaults = await describeDefaults(type, channel, locale);
        expect(defaults.eyebrow).toBeTruthy();
        expect(defaults.title).toBeTruthy();
        expect(defaults.footer).toBeTruthy();
        expect(defaults.button.label).toBeTruthy();
      }
    }
  });
});

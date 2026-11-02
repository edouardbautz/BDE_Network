import { describe, expect, it } from 'vitest';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import { buildConfirmationMessage, type NotificationEventData } from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { ITEMS } from './templates/catalog';
import type { TemplateContext } from './templates/types';
import { getNotificationTranslate } from './translate';

/**
 * The announcement of an event that came from a proposal, as it is sent: the same card as any confirmed event, with who proposed it and who
 * validated it. Its own files (`__golden__/proposal-*.json`), so that the references of the announcement of an event that did not come from a
 * proposal (`events-*.json`) stay exactly as they were, which the first test below also states.
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const PARIS = 'Europe/Paris';
const BRAND = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png', accent: '#2f5bea' };
const HOSTILE = '@everyone <!channel> <@123> <b>x</b> [a](https://evil.example) & "q"';

const event = (over: Partial<NotificationEventData> = {}): NotificationEventData => ({
  eventId: 'evt1',
  title: 'Soirée de rentrée',
  description: 'DJ set, photomaton et buffet.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula Martin'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  repeat: null,
  url: 'https://bde.example.fr/fr/events/evt1',
  ...over,
});

const CASES: Record<string, NotificationEventData> = {
  proposal: event({
    review: { authorName: 'Dave Pôle', reviewerName: 'Vera Validatrice', comment: null },
  }),
  hostile: event({
    review: { authorName: HOSTILE, reviewerName: HOSTILE, comment: null },
  }),
};

describe.each(['fr', 'en'] as const)(
  'the announcement of a proposal as it is sent (%s)',
  (locale) => {
    it('the cards, messages and e-mails', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const out: Record<string, unknown> = {};
      for (const [name, data] of Object.entries(CASES)) {
        const email = buildEventEmail('confirmed', data, t, locale, PARIS, BRAND);
        out[name] = {
          plain: buildConfirmationMessage(data, t, locale, PARIS),
          discord: buildEventEmbed('confirmed', data, t, PARIS, NOW),
          slack: buildEventSlack('confirmed', data, t, locale, PARIS, BRAND),
          email: { subject: email.subject, text: email.text },
        };
      }
      await expect(JSON.stringify(out, null, 2)).toMatchFileSnapshot(
        `./__golden__/proposal-${locale}.json`,
      );
    });

    it('says who proposed the event and who validated it, and says nothing of them for an event that did not come from a proposal', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const withReview = JSON.stringify(
        buildEventEmbed('confirmed', CASES.proposal!, t, PARIS, NOW),
      );
      expect(withReview).toContain('Dave Pôle');
      expect(withReview).toContain('Vera Validatrice');
      const without = JSON.stringify(buildEventEmbed('confirmed', event(), t, PARIS, NOW));
      expect(without).not.toContain('Dave Pôle');
      expect(without).not.toContain(t('embed.fields.proposedBy'));
    });

    it('a template that lists every fact in the order the channel shows them changes nothing', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const data = CASES.proposal!;
      const listed: TemplateContext = {
        template: {
          items: {
            order: 'native',
            list: ITEMS.eventConfirmed.map((id) => ({ id, enabled: true })),
          },
        },
      };
      expect(buildEventEmbed('confirmed', data, t, PARIS, NOW, listed)).toEqual(
        buildEventEmbed('confirmed', data, t, PARIS, NOW),
      );
      expect(buildEventSlack('confirmed', data, t, locale, PARIS, BRAND, listed)).toEqual(
        buildEventSlack('confirmed', data, t, locale, PARIS, BRAND),
      );
    });

    it('a template written before the two facts existed does not show them: nothing appears behind its back', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const before: TemplateContext = {
        template: {
          items: {
            order: 'native',
            list: ['when', 'where', 'description', 'category', 'assignees', 'repeats'].map(
              (id) => ({
                id: id as (typeof ITEMS.eventConfirmed)[number],
                enabled: true,
              }),
            ),
          },
        },
      };
      const card = JSON.stringify(
        buildEventEmbed('confirmed', CASES.proposal!, t, PARIS, NOW, before),
      );
      expect(card).not.toContain('Dave Pôle');
      expect(card).not.toContain('Vera Validatrice');
    });
  },
);

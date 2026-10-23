import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EventCardKind } from '@/lib/events/card-kind';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import {
  buildConfirmationMessage,
  buildReminderMessage,
  buildReviewMessage,
  type NotificationEventData,
} from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { buildMemberEmbed } from '@/lib/members/discord-embed';
import { buildApprovedEmail, buildPendingEmail } from '@/lib/members/email';
import {
  buildApprovedMessage,
  buildPendingMessage,
  buildRemovedMessage,
  type MemberFacts,
} from '@/lib/members/messages';
import { buildMemberSlack } from '@/lib/members/slack-blocks';
import { ITEMS } from './templates/catalog';
import type { TemplateContext, TemplateType } from './templates/types';
import { getNotificationTranslate } from './translate';

/**
 * The notifications as they are sent today, written down: every kind of every channel (Discord card, Slack message,
 * e-mail, plain text), in both languages, for a complete case, a bare one, one with texts longer than any limit and one
 * with hostile text. The files of `__golden__/` are the reference: whatever is done to how notifications are built (the
 * templates of the BDE, one day the redesign of a card), the default rendering stays what these files say, to the byte, until
 * a pull request changes them on purpose and says why (a change of look is a change of these files, read by a person).
 * The HTML of an e-mail is kept in full for two cases and as a digest for the others: a digest says "this changed", the full
 * files say what.
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const PARIS = 'Europe/Paris';
const BRAND = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png', accent: '#2f5bea' };
const BARE_BRAND = { name: 'BDE Nice', accent: '#2f5bea' };
const LONG = 'Un texte très long. '.repeat(70).trim();
const HOSTILE =
  '@everyone <!channel> <@123> <b>x</b> [a](https://evil.example) & "q" \'s\' *b* _i_';

const event = (over: Partial<NotificationEventData> = {}): NotificationEventData => ({
  eventId: 'evt1',
  title: 'Soirée de rentrée',
  description: 'DJ set, photomaton et buffet.\nEntrée libre pour les membres.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula Martin', 'Sam Durand'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  repeat: 'Chaque semaine le samedi, jusqu’au 15 décembre 2026',
  url: 'https://bde.example.fr/fr/events/evt1?occ=1',
  ...over,
});

const REVIEW = {
  authorName: 'Camille Martin',
  reviewerName: 'Paula Martin',
  comment: 'Le foyer est déjà réservé ce soir-là.\nMerci de proposer une autre date.',
};

const EVENT_CASES: Record<string, NotificationEventData> = {
  full: event(),
  bare: event({
    description: null,
    location: null,
    assigneeNames: [],
    repeat: null,
    categoryColor: null,
    url: null,
  }),
  longer: event({
    title: LONG,
    description: LONG,
    location: LONG,
    categoryLabel: LONG,
    assigneeNames: Array.from({ length: 24 }, (_, i) => `Personne ${i} ${'x'.repeat(40)}`),
    repeat: LONG,
    end: new Date('2026-10-12T21:30:00Z'),
  }),
  hostile: event({
    title: HOSTILE,
    description: HOSTILE,
    location: HOSTILE,
    categoryLabel: HOSTILE,
    assigneeNames: [HOSTILE],
    repeat: HOSTILE,
    url: 'javascript:alert(1)',
  }),
};

const EVENT_KINDS: EventCardKind[] = [
  'confirmed',
  'tomorrow',
  'today',
  'proposed',
  'approved',
  'refused',
  'test',
];

/** What each kind of card knows besides the event: the proposal circuit adds who proposed, who answered, and why. */
function withReview(kind: EventCardKind, data: NotificationEventData): NotificationEventData {
  if (kind === 'proposed')
    return { ...data, review: { ...REVIEW, reviewerName: null, comment: null } };
  if (kind === 'approved') return { ...data, review: { ...REVIEW, comment: null } };
  if (kind === 'refused') return { ...data, review: REVIEW };
  return data;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const cut = (email: { html: string; text: string; subject?: string }, full: boolean) => ({
  ...(email.subject !== undefined && { subject: email.subject }),
  text: email.text,
  html: full ? email.html : { sha256: digest(email.html), length: email.html.length },
});

const MEMBER_CASES: Record<string, MemberFacts> = {
  full: {
    login: 'cmartin',
    fullName: 'Camille Martin',
    campus: 'Nice',
    photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
    roleName: 'Trésorier',
    actorName: 'Paula Martin',
  },
  bare: { login: 'cmartin', fullName: 'Camille Martin' },
  hostile: {
    login: 'cmartin',
    fullName: HOSTILE,
    campus: HOSTILE,
    photoUrl: 'javascript:alert(1)',
    roleName: HOSTILE,
    actorName: HOSTILE,
  },
  longer: {
    login: 'cmartin',
    fullName: LONG,
    campus: LONG,
    photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
    roleName: LONG,
    actorName: LONG,
  },
};

/** Every card, message and e-mail of the events, for every case and kind. `context` is what a BDE's template would add. */
async function eventOutputs(locale: 'fr' | 'en', context?: TemplateContext) {
  const t = await getNotificationTranslate(locale, 'events.notifications');
  const out: Record<string, unknown> = {};
  for (const [name, base] of Object.entries(EVENT_CASES)) {
    for (const kind of EVENT_KINDS) {
      const data = withReview(kind, {
        ...base,
        ...(base.url && { url: base.url.replace('/fr/', `/${locale}/`) }),
      });
      const brand = name === 'bare' ? BARE_BRAND : BRAND;
      const email = buildEventEmail(
        kind,
        data,
        t,
        locale,
        PARIS,
        brand,
        kind === 'confirmed' ? { filename: 'e.ics', content: 'BEGIN:VCALENDAR' } : undefined,
        context,
      );
      out[`${name}/${kind}`] = {
        discord: buildEventEmbed(kind, data, t, PARIS, NOW, context),
        slack: buildEventSlack(kind, data, t, locale, PARIS, brand, context),
        email: cut(email, name === 'full' && (kind === 'confirmed' || kind === 'refused')),
      };
    }
  }
  return out;
}

/** The same for the members. */
async function memberOutputs(locale: 'fr' | 'en', context?: TemplateContext) {
  const t = await getNotificationTranslate(locale, 'members.notifications');
  const url = (path: string) => `https://bde.example.fr/${locale}${path}`;
  const out: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(MEMBER_CASES)) {
    const brand = name === 'bare' ? BARE_BRAND : BRAND;
    for (const kind of ['pending', 'approved', 'removed'] as const) {
      const link = kind === 'removed' ? null : url('/members');
      const entry: Record<string, unknown> = {
        discord: buildMemberEmbed(kind, member, t, link, NOW, context),
        slack: buildMemberSlack(kind, member, t, link, brand, context),
      };
      if (kind === 'pending') {
        entry.email = cut(
          buildPendingEmail(member, t, link, brand, locale, context),
          name === 'full',
        );
      }
      if (kind === 'approved') {
        entry.email = cut(
          buildApprovedEmail(
            member,
            member.roleName ?? 'Membre',
            t,
            url(''),
            brand,
            locale,
            context,
          ),
          name === 'full',
        );
      }
      out[`${name}/${kind}`] = entry;
    }
    // the plain texts do not follow a template: they are what every channel falls back to
    out[`${name}/plain`] = {
      pending: buildPendingMessage(member, t, url('/members')),
      approved: buildApprovedMessage(member, member.roleName ?? 'Membre', t),
      removed: buildRemovedMessage(member, t),
    };
  }
  return out;
}

describe.each(['fr', 'en'] as const)('the notifications as they are sent (%s)', (locale) => {
  it('the cards, messages and e-mails of the events', async () => {
    await expect(JSON.stringify(await eventOutputs(locale), null, 2)).toMatchFileSnapshot(
      `./__golden__/events-${locale}.json`,
    );
  });

  it('the plain messages of the events', async () => {
    const t = await getNotificationTranslate(locale, 'events.notifications');
    const out: Record<string, unknown> = {};
    for (const [name, base] of Object.entries(EVENT_CASES)) {
      out[name] = {
        confirmed: buildConfirmationMessage(base, t, locale, PARIS),
        tomorrow: buildReminderMessage(base, t, locale, PARIS, 'tomorrow'),
        today: buildReminderMessage(base, t, locale, PARIS, 'today'),
        proposed: buildReviewMessage('proposed', withReview('proposed', base), t, locale, PARIS),
        approved: buildReviewMessage('approved', withReview('approved', base), t, locale, PARIS),
        refused: buildReviewMessage('refused', withReview('refused', base), t, locale, PARIS),
      };
    }
    await expect(JSON.stringify(out, null, 2)).toMatchFileSnapshot(
      `./__golden__/events-plain-${locale}.json`,
    );
  });

  it('the cards, messages and e-mails of the members', async () => {
    await expect(JSON.stringify(await memberOutputs(locale), null, 2)).toMatchFileSnapshot(
      `./__golden__/members-${locale}.json`,
    );
  });

  it('a template that says nothing changes nothing, whatever the channel, the kind or the text', async () => {
    const empty: TemplateContext = { template: {}, bdeName: 'BDE Nice', locale };
    expect(await eventOutputs(locale, empty)).toEqual(await eventOutputs(locale));
    expect(await memberOutputs(locale, empty)).toEqual(await memberOutputs(locale));
  });

  it('nor does a template that lists every fact in the order the channel shows them', async () => {
    // an explicit list is the BDE saying "these, as they are": the same notification
    const list = (type: TemplateType) => ({
      items: {
        order: 'native' as const,
        list: ITEMS[type].map((id) => ({ id, enabled: true })),
      },
    });
    const t = await getNotificationTranslate(locale, 'events.notifications');
    const data = withReview('refused', EVENT_CASES.full!);
    const plain = buildEventEmbed('refused', data, t, PARIS, NOW);
    const listed = buildEventEmbed('refused', data, t, PARIS, NOW, {
      template: list('eventRefused'),
    });
    expect(listed).toEqual(plain);
  });
});

describe('the reference itself', () => {
  it('does not depend on the machine: dates are formatted in the zone it is given', () => {
    const t = new Intl.DateTimeFormat('fr', { timeZone: PARIS, timeStyle: 'short' });
    expect(t.format(new Date('2026-10-10T18:00:00Z'))).toBe('20:00');
  });
});

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IntraCardKind } from '@/lib/events/card-kind';
import { INTRA_CARD_KINDS } from '@/lib/events/card-kind';
import { buildEventEmbed } from '@/lib/events/discord-embed';
import { buildEventEmail } from '@/lib/events/email';
import { causeText, intraChangeLines, intraFacts, intraFieldLines } from '@/lib/events/intra-facts';
import type { IntraContent } from '@/lib/events/intra-request';
import { buildIntraMessage, type NotificationEventData } from '@/lib/events/messages';
import { buildEventSlack } from '@/lib/events/slack-blocks';
import { ITEMS } from './templates/catalog';
import type { TemplateContext } from './templates/types';
import { getNotificationTranslate } from './translate';

/**
 * The notifications about the publication on the intra as they are sent, written down like those of `golden.test.ts`: every kind of
 * every channel, in both languages, for a complete case, a bare one, one longer than any limit and one with hostile text. Their own
 * files (`__golden__/intra-*.json`), so that the references of the notifications that existed before stay exactly as they were.
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const PARIS = 'Europe/Paris';
const BRAND = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png', accent: '#2f5bea' };
const BARE_BRAND = { name: 'BDE Nice', accent: '#2f5bea' };
const LONG = 'Un texte très long. '.repeat(70).trim();
const HOSTILE =
  '@everyone <!channel> <@123> <b>x</b> [a](https://evil.example) & "q" \'s\' *b* _i_';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const cut = (email: { html: string; text: string; subject?: string }, full: boolean) => ({
  ...(email.subject !== undefined && { subject: email.subject }),
  text: email.text,
  html: full ? email.html : { sha256: digest(email.html), length: email.html.length },
});

const event = (over: Partial<NotificationEventData> = {}): NotificationEventData => ({
  eventId: 'evt1',
  title: 'Soirée de rentrée',
  description: 'DJ set, photomaton et buffet.\nEntrée libre pour les membres.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula Martin'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  repeat: 'Chaque semaine le samedi, jusqu’au 15 décembre 2026',
  url: 'https://bde.example.fr/fr/events/intra/evt1',
  ...over,
});

const CASES: Record<string, NotificationEventData> = {
  full: event(),
  bare: event({ description: null, location: null, repeat: null, categoryColor: null, url: null }),
  longer: event({
    title: LONG,
    description: LONG,
    location: LONG,
    repeat: LONG,
    end: new Date('2026-10-12T21:30:00Z'),
  }),
  hostile: event({
    title: HOSTILE,
    description: HOSTILE,
    location: HOSTILE,
    repeat: HOSTILE,
    url: 'javascript:alert(1)',
  }),
};

const contentOf = (text: string, maxPeople: number): IntraContent => ({
  title: text,
  description: text,
  location: text,
  fields: {
    organizerLogin: 'cmartin',
    audience: 'BOTH',
    maxPeople,
    waitingList: true,
    kind: 'Association',
    unsubscribeHours: 24,
    keywords: ['bde', 'soirée'],
  },
  dates: [
    { start: '2026-10-10T18:00:00.000Z', end: '2026-10-10T21:30:00.000Z' },
    { start: '2026-10-17T18:00:00.000Z', end: '2026-10-17T21:30:00.000Z' },
  ],
});

type Translate = Awaited<ReturnType<typeof getNotificationTranslate>>;

/** What each kind knows besides the event: who, why, the fields of the form, what changed. */
function withFacts(
  kind: IntraCardKind,
  name: string,
  data: NotificationEventData,
  t: Translate,
): NotificationEventData {
  const text = name === 'hostile' ? HOSTILE : name === 'longer' ? LONG : 'Soirée de rentrée';
  const person = name === 'hostile' ? HOSTILE : 'Paula Martin';
  const now = contentOf(text, 80);
  const earlier: IntraContent = {
    ...contentOf(`${text} (avant)`, 60),
    dates: [{ start: '2026-10-03T18:00:00.000Z', end: '2026-10-03T21:30:00.000Z' }, now.dates[0]!],
  };
  switch (kind) {
    case 'intraRequested':
      return {
        ...data,
        intra: intraFacts({ requestedByName: person, fields: intraFieldLines(now, t) }),
      };
    case 'intraChanged':
      return {
        ...data,
        intra: intraFacts({
          actorName: person,
          changes: intraChangeLines(earlier, now, t, PARIS),
        }),
      };
    case 'intraCancelled':
      return { ...data, intra: intraFacts({ actorName: person, cause: causeText('deleted', t) }) };
    case 'intraPublished':
      return {
        ...data,
        intra: intraFacts({
          actorName: person,
          intraUrl:
            name === 'hostile' ? 'javascript:alert(1)' : 'https://profile.intra.42.fr/events/12345',
        }),
      };
    case 'intraRefused':
      return {
        ...data,
        intra: intraFacts({
          actorName: person,
          comment:
            name === 'hostile'
              ? HOSTILE
              : 'La salle est prise ce soir-là.\nMerci d’en choisir une autre.',
        }),
      };
  }
}

async function outputs(locale: 'fr' | 'en', context?: TemplateContext) {
  const t = await getNotificationTranslate(locale, 'events.notifications');
  const out: Record<string, unknown> = {};
  for (const [name, base] of Object.entries(CASES)) {
    for (const kind of INTRA_CARD_KINDS) {
      const data = withFacts(
        kind,
        name,
        {
          ...base,
          ...(base.url && { url: base.url.replace('/fr/', `/${locale}/`) }),
        },
        t,
      );
      const brand = name === 'bare' ? BARE_BRAND : BRAND;
      const email = buildEventEmail(kind, data, t, locale, PARIS, brand, undefined, context);
      out[`${name}/${kind}`] = {
        discord: buildEventEmbed(kind, data, t, PARIS, NOW, context),
        slack: buildEventSlack(kind, data, t, locale, PARIS, brand, context),
        email: cut(
          email,
          name === 'full' && (kind === 'intraRequested' || kind === 'intraChanged'),
        ),
      };
    }
  }
  return out;
}

describe.each(['fr', 'en'] as const)(
  'the notifications about the intra as they are sent (%s)',
  (locale) => {
    it('the cards, messages and e-mails', async () => {
      await expect(JSON.stringify(await outputs(locale), null, 2)).toMatchFileSnapshot(
        `./__golden__/intra-${locale}.json`,
      );
    });

    it('the plain messages', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      const out: Record<string, unknown> = {};
      for (const [name, base] of Object.entries(CASES)) {
        out[name] = Object.fromEntries(
          INTRA_CARD_KINDS.map((kind) => [
            kind,
            buildIntraMessage(kind, withFacts(kind, name, base, t), t, locale, PARIS),
          ]),
        );
      }
      await expect(JSON.stringify(out, null, 2)).toMatchFileSnapshot(
        `./__golden__/intra-plain-${locale}.json`,
      );
    });

    it('a template that says nothing changes nothing, whatever the channel, the kind or the text', async () => {
      const empty: TemplateContext = { template: {}, bdeName: 'BDE Nice', locale };
      expect(await outputs(locale, empty)).toEqual(await outputs(locale));
    });

    it('nor does a template that lists every fact in the order the channel shows them', async () => {
      const t = await getNotificationTranslate(locale, 'events.notifications');
      for (const kind of INTRA_CARD_KINDS) {
        const data = withFacts(kind, 'full', CASES.full!, t);
        const listed: TemplateContext = {
          template: {
            items: { order: 'native', list: ITEMS[kind].map((id) => ({ id, enabled: true })) },
          },
        };
        expect(buildEventEmbed(kind, data, t, PARIS, NOW, listed)).toEqual(
          buildEventEmbed(kind, data, t, PARIS, NOW),
        );
        expect(buildEventSlack(kind, data, t, locale, PARIS, BRAND, listed)).toEqual(
          buildEventSlack(kind, data, t, locale, PARIS, BRAND),
        );
        expect(buildEventEmail(kind, data, t, locale, PARIS, BRAND, undefined, listed)).toEqual(
          buildEventEmail(kind, data, t, locale, PARIS, BRAND),
        );
      }
    });
  },
);

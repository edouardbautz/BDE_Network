import { describe, expect, it } from 'vitest';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { buildEventEmbed } from './discord-embed';
import type { EventCardKind } from './card-kind';
import type { NotificationEventData, Translate } from './messages';

// Echoes the key and values so the assertions don't depend on the catalog wording.
const t: Translate = (key, values) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

const PARIS = 'Europe/Paris';
const NOW = new Date('2026-10-06T12:00:00Z');
const BLANK = '​';

const base: NotificationEventData = {
  eventId: 'evt1',
  title: 'Soirée de rentrée',
  description: 'DJ set et buffet.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula', 'Sam'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  recurrence: 'NONE',
  recurrenceUntil: null,
  url: 'https://bde.example.fr/fr/events/evt1?occ=1',
};

const build = (data: Partial<NotificationEventData> = {}, kind: EventCardKind = 'confirmed') =>
  buildEventEmbed(kind, { ...base, ...data }, t, PARIS, NOW);
const lines = (embed: ReturnType<typeof build>) => (embed.description ?? '').split('\n');
const names = (embed: ReturnType<typeof build>) => embed.fields?.map((field) => field.name);
const fieldNamed = (embed: ReturnType<typeof build>, name: string) =>
  embed.fields?.find((field) => field.name.endsWith(name));

describe('buildEventEmbed', () => {
  it('puts the category colour on the bar and links the title to the event', () => {
    const embed = build();

    expect(embed.color).toBe(0xdb2777);
    expect(embed.url).toBe('https://bde.example.fr/fr/events/evt1?occ=1');
  });

  it('uses the neutral grey for a category that has no colour any more', () => {
    expect(build({ categoryColor: null }).color).toBe(0x6b7280);
  });

  it('has no link at all without APP_URL, or with an address that is not http', () => {
    expect(build({ url: null }).url).toBeUndefined();
    expect(build({ url: 'javascript:alert(1)' }).url).toBeUndefined();
  });

  describe('the title', () => {
    it.each([
      ['confirmed', '🎉'],
      ['tomorrow', '⏰'],
      ['today', '🔔'],
    ] as const)('is the event title with its own icon on a %s card', (kind, icon) => {
      expect(build({}, kind).title).toBe(`${icon}  Soirée de rentrée`);
    });
  });

  describe('the description: the essentials as headings, in order', () => {
    it('is the kind in small capitals, then when, where, and the event description as a quote', () => {
      expect(lines(build())).toEqual([
        '-# EMBED.KIND.CONFIRMED',
        BLANK,
        '### 📅  <t:1791655200:F>',
        '<t:1791655200:t> → <t:1791667800:t>  ·  <t:1791655200:R>',
        BLANK,
        '### 📍  Foyer du campus',
        BLANK,
        '> DJ set et buffet.',
        BLANK,
      ]);
    });

    it.each([
      ['confirmed', 'embed.kind.confirmed'],
      ['tomorrow', 'embed.kind.reminderTomorrow'],
      ['today', 'embed.kind.reminderToday'],
    ] as const)('names the %s card in its first line', (kind, key) => {
      expect(lines(build({}, kind))[0]).toBe(`-# ${key.toUpperCase()}`);
    });

    it('writes the dates as Discord markup, with a countdown, so each reader sees their own time zone', () => {
      const [, , when, time] = lines(build());

      expect(when).toBe('### 📅  <t:1791655200:F>');
      expect(time).toBe('<t:1791655200:t> → <t:1791667800:t>  ·  <t:1791655200:R>');
    });

    it('writes the end as a full date when the event ends another day', () => {
      const overnight = build({ end: new Date('2026-10-11T01:00:00Z') });

      expect(lines(overnight)[3]).toBe('<t:1791655200:t> → <t:1791680400:F>  ·  <t:1791655200:R>');
    });

    it('judges "the same day" on the BDE wall clock, not in UTC', () => {
      // 22:30 → 00:30 Paris: the same day in UTC, two days on the wall clock.
      const late = build({
        start: new Date('2026-10-10T20:30:00Z'),
        end: new Date('2026-10-10T22:30:00Z'),
      });

      expect(lines(late)[3]).toContain('→ <t:1791671400:F>');
    });

    it('leaves out the place, and the description, when there are none', () => {
      const bare = build({ location: null, description: null });

      expect(lines(bare)).toEqual([
        '-# EMBED.KIND.CONFIRMED',
        BLANK,
        '### 📅  <t:1791655200:F>',
        '<t:1791655200:t> → <t:1791667800:t>  ·  <t:1791655200:R>',
        BLANK,
      ]);
      expect(lines(build({ description: '   ' })).some((line) => line.startsWith('>'))).toBe(false);
    });

    it('quotes every line of the description, a blank one too, or the quote would stop there', () => {
      const quote = lines(build({ description: 'Un.\n\nDeux.' })).filter((line) =>
        line.startsWith('>'),
      );

      expect(quote).toEqual(['> Un.', `> ${BLANK}`, '> Deux.']);
    });

    it('shows 350 characters of the description at most, cut with an ellipsis', () => {
      const [quote] = lines(build({ description: 'x'.repeat(1500) })).filter((line) =>
        line.startsWith('>'),
      );

      expect(Array.from(quote ?? '')).toHaveLength(352); // "> " + 350
      expect(quote?.endsWith('…')).toBe(true);
    });

    it('keeps a description of exactly 350 characters whole', () => {
      expect(lines(build({ description: 'y'.repeat(350) }))).toContain(`> ${'y'.repeat(350)}`);
    });

    it('keeps the place on one line, whatever was typed: it must not open another heading', () => {
      const embed = build({ location: 'Salle B\n### 💥 faux titre' });

      expect(lines(embed)).toContain('### 📍  Salle B ### 💥 faux titre');
      expect(lines(embed).filter((line) => line.startsWith('###'))).toHaveLength(2);
    });
  });

  describe('the fields: the secondary facts', () => {
    it('shows the category and the people in charge side by side, with their icons', () => {
      const embed = build();

      expect(names(embed)).toEqual(['🏷️  embed.fields.category', '👥  embed.fields.inCharge']);
      expect(embed.fields?.every((field) => field.inline)).toBe(true);
      expect(fieldNamed(embed, 'embed.fields.inCharge')?.value).toBe('Paula, Sam');
      expect(fieldNamed(embed, 'embed.fields.category')?.value).toBe('Soirée');
    });

    it('does not repeat the date or the place in them', () => {
      expect(names(build())?.join()).not.toMatch(/when|where/);
    });

    it('leaves out the people in charge when there are none', () => {
      expect(names(build({ assigneeNames: [] }))).toEqual(['🏷️  embed.fields.category']);
    });

    it('says when and until when a series repeats, on its own line, with the date as Discord markup', () => {
      const embed = build({
        recurrence: 'WEEKLY',
        recurrenceUntil: new Date('2026-12-17T16:30:00Z'),
      });
      const repeats = fieldNamed(embed, 'embed.fields.repeats');

      expect(repeats?.name).toBe('🔁  embed.fields.repeats');
      expect(repeats?.value).toBe('embed.repeatsValue.WEEKLY(until=<t:1797525000:D>)');
      expect(repeats?.inline).toBeFalsy();
    });

    it.each(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const)(
      'picks the %s wording of the repetition',
      (recurrence) => {
        const embed = build({ recurrence, recurrenceUntil: new Date('2026-12-17T16:30:00Z') });

        expect(fieldNamed(embed, 'embed.fields.repeats')?.value).toBe(
          `embed.repeatsValue.${recurrence}(until=<t:1797525000:D>)`,
        );
      },
    );

    it('shows no repetition line for a one-off event, even if an end date of a series was kept', () => {
      expect(fieldNamed(build(), 'embed.fields.repeats')).toBeUndefined();
      expect(
        fieldNamed(
          build({ recurrence: 'NONE', recurrenceUntil: new Date('2026-12-17T16:30:00Z') }),
          'embed.fields.repeats',
        ),
      ).toBeUndefined();
    });
  });

  it('signs the card with the platform name, and stamps it with the sending time', () => {
    const embed = build();

    expect(embed.footer).toEqual({ text: PLATFORM_NAME });
    expect(PLATFORM_NAME).toBe('BDE_Network');
    expect(embed.timestamp).toBe('2026-10-06T12:00:00.000Z');
  });

  it('leaves the BDE name and logo to withDiscordCard: no author, no thumbnail of its own', () => {
    const embed = build();

    expect(embed).not.toHaveProperty('author');
    expect(embed).not.toHaveProperty('thumbnail');
  });
});

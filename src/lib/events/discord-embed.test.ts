import { describe, expect, it } from 'vitest';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { buildEventEmbed } from './discord-embed';
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

const fieldNamed = (embed: ReturnType<typeof buildEventEmbed>, name: string) =>
  embed.fields?.find((field) => field.name === name);

describe('buildEventEmbed', () => {
  it('puts the category colour on the bar and links the title to the event', () => {
    const embed = buildEventEmbed('confirmed', base, t, PARIS, NOW);

    expect(embed.color).toBe(0xdb2777);
    expect(embed.title).toBe('Soirée de rentrée');
    expect(embed.url).toBe('https://bde.example.fr/fr/events/evt1?occ=1');
  });

  it('uses the neutral grey for a category that has no colour any more', () => {
    const embed = buildEventEmbed('confirmed', { ...base, categoryColor: null }, t, PARIS, NOW);
    expect(embed.color).toBe(0x6b7280);
  });

  it('has no link at all without APP_URL, or with an address that is not http', () => {
    expect(buildEventEmbed('confirmed', { ...base, url: null }, t, PARIS, NOW).url).toBeUndefined();
    expect(
      buildEventEmbed('confirmed', { ...base, url: 'javascript:alert(1)' }, t, PARIS, NOW).url,
    ).toBeUndefined();
  });

  it('writes the dates as Discord markup, with a countdown, so each reader sees their own time zone', () => {
    const when = fieldNamed(buildEventEmbed('confirmed', base, t, PARIS, NOW), 'embed.fields.when');

    expect(when?.value).toBe('<t:1791655200:F> → <t:1791667800:t>\n<t:1791655200:R>');
    expect(when?.inline).toBeFalsy(); // the date takes the full width
  });

  it('writes the end as a full date when the event ends another day', () => {
    const overnight = { ...base, end: new Date('2026-10-11T01:00:00Z') };
    const when = fieldNamed(
      buildEventEmbed('confirmed', overnight, t, PARIS, NOW),
      'embed.fields.when',
    );

    expect(when?.value).toBe('<t:1791655200:F> → <t:1791680400:F>\n<t:1791655200:R>');
  });

  it('judges "the same day" on the BDE wall clock, not in UTC', () => {
    // 22:30 → 00:30 Paris: the same day in UTC, two days on the wall clock.
    const late = {
      ...base,
      start: new Date('2026-10-10T20:30:00Z'),
      end: new Date('2026-10-10T22:30:00Z'),
    };
    const when = fieldNamed(buildEventEmbed('confirmed', late, t, PARIS, NOW), 'embed.fields.when');

    expect(when?.value).toContain('→ <t:1791671400:F>');
  });

  it('shows the place, the category and the people in charge as three columns, in this order', () => {
    const { fields } = buildEventEmbed('confirmed', base, t, PARIS, NOW);

    expect(fields?.map((field) => field.name)).toEqual([
      'embed.fields.when',
      'embed.fields.where',
      'embed.fields.category',
      'embed.fields.inCharge',
    ]);
    expect(fields?.slice(1).every((field) => field.inline)).toBe(true);
    expect(
      fieldNamed(buildEventEmbed('confirmed', base, t, PARIS, NOW), 'embed.fields.inCharge')?.value,
    ).toBe('Paula, Sam');
  });

  it('leaves out the place and the people in charge when there are none', () => {
    const bare = { ...base, location: null, assigneeNames: [] };
    const { fields } = buildEventEmbed('confirmed', bare, t, PARIS, NOW);

    expect(fields?.map((field) => field.name)).toEqual([
      'embed.fields.when',
      'embed.fields.category',
    ]);
  });

  it('says when and until when a series repeats, with the date as Discord markup', () => {
    const weekly: NotificationEventData = {
      ...base,
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-12-17T16:30:00Z'),
    };
    const repeats = fieldNamed(
      buildEventEmbed('confirmed', weekly, t, PARIS, NOW),
      'embed.fields.repeats',
    );

    expect(repeats?.value).toBe('embed.repeatsValue.WEEKLY(until=<t:1797525000:D>)');
  });

  it.each(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const)(
    'picks the %s wording of the repetition',
    (recurrence) => {
      const repeats = fieldNamed(
        buildEventEmbed(
          'confirmed',
          { ...base, recurrence, recurrenceUntil: new Date('2026-12-17T16:30:00Z') },
          t,
          PARIS,
          NOW,
        ),
        'embed.fields.repeats',
      );
      expect(repeats?.value).toBe(`embed.repeatsValue.${recurrence}(until=<t:1797525000:D>)`);
    },
  );

  it('shows no repetition line for a one-off event', () => {
    expect(
      fieldNamed(buildEventEmbed('confirmed', base, t, PARIS, NOW), 'embed.fields.repeats'),
    ).toBeUndefined();
  });

  it.each([
    ['confirmed', 'embed.kind.confirmed'],
    ['tomorrow', 'embed.kind.reminderTomorrow'],
    ['today', 'embed.kind.reminderToday'],
  ] as const)('opens the %s card with its own heading, in bold', (kind, key) => {
    const embed = buildEventEmbed(kind, base, t, PARIS, NOW);
    expect(embed.description).toBe(`**${key}**\nDJ set et buffet.`);
  });

  it('has only the heading when the event has no description', () => {
    const embed = buildEventEmbed('confirmed', { ...base, description: null }, t, PARIS, NOW);
    expect(embed.description).toBe('**embed.kind.confirmed**');
    expect(
      buildEventEmbed('confirmed', { ...base, description: '   ' }, t, PARIS, NOW).description,
    ).toBe('**embed.kind.confirmed**');
  });

  it('shows 350 characters of the description at most, cut with an ellipsis', () => {
    const embed = buildEventEmbed(
      'confirmed',
      { ...base, description: 'x'.repeat(1500) },
      t,
      PARIS,
      NOW,
    );
    const preview = (embed.description ?? '').split('\n')[1] ?? '';

    expect(Array.from(preview)).toHaveLength(350);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('keeps a description of exactly 350 characters whole', () => {
    const embed = buildEventEmbed(
      'confirmed',
      { ...base, description: 'y'.repeat(350) },
      t,
      PARIS,
      NOW,
    );
    expect(embed.description).toBe(`**embed.kind.confirmed**\n${'y'.repeat(350)}`);
  });

  it('signs the card with the platform name, and stamps it with the sending time', () => {
    const embed = buildEventEmbed('confirmed', base, t, PARIS, NOW);

    expect(embed.footer).toEqual({ text: PLATFORM_NAME });
    expect(PLATFORM_NAME).toBe('BDE_Network');
    expect(embed.timestamp).toBe('2026-10-06T12:00:00.000Z');
  });
});

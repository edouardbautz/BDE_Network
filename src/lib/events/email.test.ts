import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import { buildEventEmail, buildEventIcs } from './email';
import type { NotificationEventData, Translate } from './messages';

/** The real French catalog: a missing message fails the test. */
const t: Translate = (key, values = {}) => {
  const text = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      fr.events.notifications,
    );
  if (typeof text !== 'string') throw new Error(`missing message ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
};

const PARIS = 'Europe/Paris';
const brand = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' };

const data: NotificationEventData = {
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

const ics = { filename: 'soiree.ics', content: 'BEGIN:VCALENDAR' };

const mail = (
  over: Partial<NotificationEventData> = {},
  kind: 'confirmed' | 'tomorrow' | 'today' = 'confirmed',
  withIcs = false,
) => buildEventEmail(kind, { ...data, ...over }, t, 'fr', PARIS, brand, withIcs ? ics : undefined);

describe('buildEventEmail', () => {
  it('has the colour of the category on the bar and the button, and the title as the heading', () => {
    const { html } = mail();
    expect(html).toContain('<td bgcolor="#db2777" height="6"');
    expect(html).toContain('>Soirée de rentrée</h1>');
  });

  it('uses the neutral grey for a category that has no colour any more', () => {
    const { html } = mail({ categoryColor: null });
    expect(html).toContain('<td bgcolor="#6b7280" height="6"');
    expect(html).not.toContain('&#9679;'); // and no dot either
  });

  it('shows the fields in this order: when, where, category, members in charge', () => {
    const { text } = mail();
    const lines = text.split('\n').filter((line) => / : /.test(line) && !line.startsWith('Voir'));
    expect(lines.map((line) => line.split(' : ')[0])).toEqual([
      'Quand',
      'Lieu',
      'Catégorie',
      'Membres en charge',
    ]);
    expect(text).toContain('Quand : samedi 10 octobre 2026 à 20:00 → 23:30');
    expect(text).toContain('Membres en charge : Paula, Sam');
  });

  it('leaves out the place and the people in charge when there are none', () => {
    const { text } = mail({ location: null, assigneeNames: [] });
    expect(text).not.toContain('Lieu');
    expect(text).not.toContain('Membres en charge');
    expect(text).toContain('Catégorie : Soirée');
  });

  it('says how a series repeats, in the short form', () => {
    const weekly = mail({
      recurrence: 'WEEKLY',
      recurrenceUntil: new Date('2026-12-17T16:30:00Z'),
    });
    expect(weekly.text).toContain("Répétition : Chaque semaine, jusqu'au 17 décembre 2026");
    expect(
      mail({ recurrence: 'BIWEEKLY', recurrenceUntil: new Date('2026-12-17T16:30:00Z') }).text,
    ).toContain("Toutes les 2 semaines, jusqu'au 17 décembre 2026");
    expect(
      mail({ recurrence: 'MONTHLY', recurrenceUntil: new Date('2026-12-17T16:30:00Z') }).text,
    ).toContain("Chaque mois, jusqu'au 17 décembre 2026");
  });

  it('says nothing of repetition for a one-off event, or a series with no end date', () => {
    expect(mail().text).not.toContain('Répétition');
    expect(mail({ recurrence: 'WEEKLY', recurrenceUntil: null }).text).not.toContain('Répétition');
  });

  it('shows the description as the lead, cut at 600 characters with an ellipsis', () => {
    expect(mail().html).toContain('DJ set et buffet.');
    const long = mail({ description: 'x'.repeat(2000) }).text;
    const lead = long.split('\n').find((line) => line.startsWith('xxx')) ?? '';
    expect(Array.from(lead)).toHaveLength(600);
    expect(lead.endsWith('…')).toBe(true);
    expect(mail({ description: 'y'.repeat(600) }).text).toContain('y'.repeat(600));
  });

  it('has no lead without a description', () => {
    const { text } = mail({ description: null });
    expect(text.split('\n')[3]).toBe('Soirée de rentrée');
    expect(mail({ description: '   ' }).html).not.toContain('<p class="t-main"');
  });

  it('has a button to the event, and none without APP_URL', () => {
    expect(mail().html).toContain('href="https://bde.example.fr/fr/events/evt1?occ=1"');
    expect(mail().text).toContain("Voir l'événement : https://bde.example.fr/fr/events/evt1?occ=1");
    const bare = mail({ url: null });
    expect(bare.html).not.toContain('class="btn"');
    expect(bare.text).not.toContain("Voir l'événement");
  });

  it('writes the kind of message above the heading', () => {
    expect(mail({}, 'confirmed').text).toContain('NOUVEL ÉVÉNEMENT CONFIRMÉ');
    expect(mail({}, 'tomorrow').text).toContain('RAPPEL · DEMAIN');
    expect(mail({}, 'today').text).toContain("RAPPEL · AUJOURD'HUI");
  });

  it('has the kind, the day and the place as the preheader', () => {
    expect(mail().html).toContain(
      'Nouvel événement confirmé · samedi 10 octobre à 20:00 · Foyer du campus',
    );
    expect(mail({ location: null }).html).toContain(
      'Nouvel événement confirmé · samedi 10 octobre à 20:00&#847;',
    );
  });

  it('carries the calendar file of a confirmation, and says so under the button', () => {
    const withFile = mail({}, 'confirmed', true);
    expect(withFile.ics).toEqual(ics);
    expect(withFile.text).toContain("Le fichier joint ajoute l'événement à votre agenda.");
  });

  it('carries no calendar file, and does not talk of one, when there is none (a reminder)', () => {
    const reminder = mail({}, 'tomorrow');
    expect(reminder).not.toHaveProperty('ics');
    expect(reminder.text).not.toContain('fichier joint');
  });

  it('says why the person receives it, naming the BDE', () => {
    expect(mail().text).toContain(
      'Vous recevez ce message parce que vous êtes membre de BDE Nice.',
    );
  });

  it('is in the language it is given', async () => {
    const en = (await import('../../../messages/en.json')).default;
    const tEn: Translate = (key, values = {}) => {
      const text = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          en.events.notifications,
        );
      if (typeof text !== 'string') throw new Error(`missing message ${key}`);
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    };
    const out = buildEventEmail(
      'today',
      { ...data, recurrence: 'WEEKLY', recurrenceUntil: new Date('2026-12-17T16:30:00Z') },
      tEn,
      'en',
      PARIS,
      brand,
    );

    expect(out.html).toContain('<html lang="en"');
    expect(out.text).toContain('REMINDER · TODAY');
    expect(out.text).toContain('When : Saturday, October 10, 2026');
    expect(out.text).toContain('Repeats : Every week, until December 17, 2026');
    expect(out.text).toContain('View the event');
  });

  it('writes nothing a member typed as markup', () => {
    const { html } = mail({
      title: '<script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)>',
      location: "Salle B' onmouseover='x",
      assigneeNames: ['<i>Sam</i>'],
      categoryLabel: '"><b>',
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<i>Sam');
    expect(html).not.toContain("onmouseover='x");
  });
});

describe('buildEventIcs', () => {
  const row = {
    id: 'evt1',
    title: 'Soirée de rentrée',
    description: 'DJ set',
    location: 'Foyer',
    updatedAt: new Date('2026-10-06T10:00:00Z'),
  };
  const now = new Date('2026-10-06T12:00:00Z');
  const occurrences = [
    { start: new Date('2026-10-15T16:30:00Z'), end: new Date('2026-10-15T18:00:00Z') },
    { start: new Date('2026-10-22T16:30:00Z'), end: new Date('2026-10-22T18:00:00Z') },
  ];

  it('is named after the event', () => {
    expect(buildEventIcs(row, occurrences, 'Sport', 'BDE Nice', now).filename).toBe(
      'soiree-de-rentree.ics',
    );
  });

  it('has one event per occurrence, with the identifiers the feeds use', () => {
    const { content } = buildEventIcs(row, occurrences, 'Sport', 'BDE Nice', now);

    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(content).toContain('UID:evt1-20261015T163000Z@bde-network');
    expect(content).toContain('UID:evt1-20261022T163000Z@bde-network');
    expect(content).toContain('DTSTART:20261015T163000Z');
    expect(content).toContain('DTEND:20261015T180000Z');
  });

  it('carries the facts of the event, confirmed, and the calendar name', () => {
    const { content } = buildEventIcs(row, occurrences, 'Sport', 'BDE Nice', now);

    expect(content).toContain('SUMMARY:Soirée de rentrée');
    expect(content).toContain('DESCRIPTION:DJ set');
    expect(content).toContain('LOCATION:Foyer');
    expect(content).toContain('CATEGORIES:Sport');
    expect(content).toContain('STATUS:CONFIRMED');
    expect(content).toContain('X-WR-CALNAME:BDE Nice');
    expect(content).toContain('METHOD:PUBLISH');
    expect(content).toContain('LAST-MODIFIED:20261006T100000Z');
    expect(content).toContain('DTSTAMP:20261006T120000Z');
  });

  it('leaves out the description and the place when the event has none', () => {
    const { content } = buildEventIcs(
      { ...row, description: null, location: null },
      occurrences,
      'Sport',
      'B',
      now,
    );
    expect(content).not.toContain('DESCRIPTION');
    expect(content).not.toContain('LOCATION');
  });
});

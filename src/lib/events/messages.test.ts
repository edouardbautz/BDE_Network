import { describe, expect, it } from 'vitest';
import {
  buildConfirmationMessage,
  buildReminderMessage,
  type NotificationEventData,
  type Translate,
} from './messages';

// Echoes the key and values so the assertions don't depend on the catalog wording.
const t: Translate = (key, values) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

const base: NotificationEventData = {
  eventId: 'evt1',
  title: 'Tournoi',
  location: 'Gymnase',
  categoryLabel: 'Sport',
  assigneeNames: ['Alice', 'Bob'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:00:00Z'),
  recurrence: 'NONE',
  recurrenceUntil: null,
  url: 'https://bde.example/fr/events/evt1',
};

describe('event notification messages', () => {
  it('builds the confirmation subject and a body with every detail', () => {
    const { subject, body } = buildConfirmationMessage(base, t, 'fr', 'Europe/Paris');
    expect(subject).toBe('confirmed.subject(title=Tournoi)');
    expect(body).toContain('confirmed.intro');
    expect(body).toContain('location : Gymnase');
    expect(body).toContain('category : Sport');
    expect(body).toContain('inCharge : Alice, Bob');
    expect(body).toContain('link : https://bde.example/fr/events/evt1');
  });

  it('shows the time range in the BDE zone, on one line when it stays on one day', () => {
    const { body } = buildConfirmationMessage(base, t, 'fr', 'Europe/Paris');
    const whenLine = body.split('\n').find((line) => line.includes('→'));
    // 20:00 → 23:00 in Paris (UTC+2) on a Saturday
    expect(whenLine).toMatch(/samedi 10 octobre 2026/i);
    expect(whenLine).toContain('20:00');
    expect(whenLine).toContain('23:00');
  });

  it('mentions the recurrence for a series', () => {
    const { body } = buildReminderMessage(
      { ...base, recurrence: 'WEEKLY', recurrenceUntil: new Date('2026-12-19T22:59:00Z') },
      t,
      'fr',
      'Europe/Paris',
    );
    expect(body).toContain('recurring(frequency=frequency.WEEKLY,until=19 décembre 2026)');
  });

  it('omits optional lines when there is no location, assignee or link', () => {
    const { body } = buildReminderMessage(
      { ...base, location: null, assigneeNames: [], url: null },
      t,
      'en',
      'Europe/Paris',
    );
    expect(body).not.toContain('location');
    expect(body).not.toContain('inCharge');
    expect(body).not.toContain('link');
  });

  it('uses the reminder subject for reminders', () => {
    expect(buildReminderMessage(base, t, 'fr', 'Europe/Paris').subject).toBe(
      'reminder.subject(title=Tournoi)',
    );
  });
});

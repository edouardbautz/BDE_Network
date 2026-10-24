import { describe, expect, it } from 'vitest';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { causeText, dateText, intraChangeLines, intraFacts, intraFieldLines } from './intra-facts';
import type { IntraContent } from './intra-request';

const PARIS = 'Europe/Paris';

const content = (over: Partial<IntraContent> = {}, maxPeople = 80): IntraContent => ({
  title: 'Soirée',
  description: 'DJ set',
  location: 'Foyer',
  fields: {
    organizerLogin: 'cmartin',
    audience: 'BOTH',
    maxPeople,
    waitingList: true,
    kind: 'Association',
    unsubscribeHours: 24,
    keywords: ['bde', 'soirée'],
  },
  dates: [{ start: '2026-10-10T18:00:00.000Z', end: '2026-10-10T21:30:00.000Z' }],
  ...over,
});

describe.each(['fr', 'en'] as const)('what the messages say of the intra (%s)', (locale) => {
  const translate = () => getNotificationTranslate(locale, 'events.notifications');

  it('writes a date as the intra form takes it, with the end day only when it is another one', () => {
    expect(
      dateText({ start: '2026-10-10T18:00:00.000Z', end: '2026-10-10T21:30:00.000Z' }, PARIS),
    ).toBe('10/10/2026 20:00 → 23:30');
    expect(
      dateText({ start: '2026-10-10T18:00:00.000Z', end: '2026-10-11T01:00:00.000Z' }, PARIS),
    ).toBe('10/10/2026 20:00 → 11/10/2026 03:00');
  });

  it('lists the fields of the form the card does not show already, in the order of the form', async () => {
    const t = await translate();
    const lines = intraFieldLines(content(), t);
    expect(lines.map((line) => line.value)).toEqual([
      'cmartin',
      locale === 'fr' ? 'Les deux' : 'Both',
      '80',
      locale === 'fr' ? 'Oui' : 'Yes',
      'Association',
      '24',
      'bde, soirée',
    ]);
    expect(new Set(lines.map((line) => line.label)).size).toBe(7);
  });

  it('says what changed: the fields with the old and the new value, the dates that went and came', async () => {
    const t = await translate();
    const before = content(
      {
        title: 'Ancien',
        dates: [
          { start: '2026-10-03T18:00:00.000Z', end: '2026-10-03T21:30:00.000Z' },
          { start: '2026-10-10T18:00:00.000Z', end: '2026-10-10T21:30:00.000Z' },
        ],
      },
      60,
    );
    const lines = intraChangeLines(before, content(), t, PARIS);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Ancien');
    expect(lines[0]).toContain('Soirée');
    expect(lines[1]).toContain('60');
    expect(lines[1]).toContain('80');
    expect(lines[2]).toContain('03/10/2026 20:00 → 23:30');
  });

  it('says nothing when nothing changed', async () => {
    const t = await translate();
    expect(intraChangeLines(content(), content(), t, PARIS)).toEqual([]);
  });

  it('shows an empty value as a dash, and cuts a long one', async () => {
    const t = await translate();
    const lines = intraChangeLines(
      content({ location: '' }),
      content({ location: 'x'.repeat(500) }),
      t,
      PARIS,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('—');
    expect(lines[0]!.length).toBeLessThan(300);
  });

  it('gives a sentence for each cause of a withdrawal', async () => {
    const t = await translate();
    const sentences = (['draft', 'deleted', 'dates'] as const).map((cause) => causeText(cause, t));
    expect(new Set(sentences).size).toBe(3);
    expect(sentences.every((sentence) => sentence.length > 10)).toBe(true);
  });
});

describe('the facts of a message', () => {
  it('start empty, whatever is not given is absent', () => {
    expect(intraFacts({})).toEqual({
      requestedByName: null,
      actorName: null,
      comment: null,
      cause: null,
      intraUrl: null,
      fields: [],
      changes: [],
    });
    expect(intraFacts({ actorName: 'Paula' }).actorName).toBe('Paula');
  });
});

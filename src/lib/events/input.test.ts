import { describe, expect, it } from 'vitest';
import { parseEventInput, type RawEventInput } from './input';

const options = { timeZone: 'Europe/Paris', categoryKeys: ['soiree', 'sport'] };

function raw(overrides: Partial<RawEventInput> = {}): RawEventInput {
  return {
    title: 'Soirée de rentrée',
    description: '',
    location: '',
    categoryKey: 'soiree',
    startsAt: '2026-10-10T20:00',
    endsAt: '2026-10-11T02:00',
    recurrence: 'NONE',
    recurrenceUntil: '',
    status: 'DRAFT',
    assigneeLogins: [],
    ...overrides,
  };
}

describe('parseEventInput', () => {
  it('converts wall-clock inputs in the BDE zone to UTC and derives the school year', () => {
    const result = parseEventInput(raw(), options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startsAt).toEqual(new Date('2026-10-10T18:00:00Z'));
      expect(result.data.endsAt).toEqual(new Date('2026-10-11T00:00:00Z'));
      expect(result.data.schoolYear).toBe('2026-2027');
      expect(result.data.recurrenceUntil).toBeNull();
      expect(result.data.description).toBeNull();
      expect(result.data.location).toBeNull();
    }
  });

  it('uses winter time (UTC+1) for dates outside summer time', () => {
    const result = parseEventInput(
      raw({ startsAt: '2026-12-10T20:00', endsAt: '2026-12-10T22:00' }),
      options,
    );
    expect(result.ok && result.data.startsAt).toEqual(new Date('2026-12-10T19:00:00Z'));
  });

  it('trims text and deduplicates assignees', () => {
    const result = parseEventInput(
      raw({ title: '  Tournoi  ', assigneeLogins: ['alice', ' alice ', 'bob', ''] }),
      options,
    );
    expect(result.ok && result.data.title).toBe('Tournoi');
    expect(result.ok && result.data.assigneeLogins).toEqual(['alice', 'bob']);
  });

  it('requires a title and a known category', () => {
    const result = parseEventInput(raw({ title: '   ', categoryKey: 'unknown' }), options);
    expect(result).toEqual({
      ok: false,
      errors: { title: 'required', categoryKey: 'invalid' },
    });
  });

  it('rejects an end that is not after the start', () => {
    const result = parseEventInput(raw({ endsAt: '2026-10-10T20:00' }), options);
    expect(result).toEqual({ ok: false, errors: { endsAt: 'endBeforeStart' } });
  });

  it('rejects missing or malformed dates', () => {
    expect(parseEventInput(raw({ startsAt: '' }), options)).toMatchObject({
      ok: false,
      errors: { startsAt: 'required' },
    });
    expect(parseEventInput(raw({ endsAt: '2026-02-30T10:00' }), options)).toMatchObject({
      ok: false,
      errors: { endsAt: 'invalid' },
    });
  });

  it('rejects over-long fields', () => {
    const result = parseEventInput(
      raw({ title: 'x'.repeat(121), location: 'y'.repeat(201), description: 'z'.repeat(5001) }),
      options,
    );
    expect(result).toEqual({
      ok: false,
      errors: { title: 'tooLong', location: 'tooLong', description: 'tooLong' },
    });
  });

  describe('recurrence', () => {
    it('requires an end date for a recurring event', () => {
      const result = parseEventInput(raw({ recurrence: 'WEEKLY' }), options);
      expect(result).toEqual({ ok: false, errors: { recurrenceUntil: 'untilRequired' } });
    });

    it('rejects an end date before the first occurrence', () => {
      const result = parseEventInput(
        raw({ recurrence: 'WEEKLY', recurrenceUntil: '2026-10-01' }),
        options,
      );
      expect(result).toEqual({ ok: false, errors: { recurrenceUntil: 'untilBeforeStart' } });
    });

    it('treats the end date as inclusive (end of that local day)', () => {
      const result = parseEventInput(
        raw({ recurrence: 'WEEKLY', recurrenceUntil: '2026-10-24' }),
        options,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 23:59 Paris on 24 Oct (UTC+2) = 21:59 UTC
        expect(result.data.recurrenceUntil).toEqual(new Date('2026-10-24T21:59:00Z'));
      }
    });

    it('ignores the end date of a non-recurring event', () => {
      const result = parseEventInput(raw({ recurrenceUntil: '2030-01-01' }), options);
      expect(result.ok && result.data.recurrenceUntil).toBeNull();
    });

    it('rejects an unknown recurrence value', () => {
      const result = parseEventInput(raw({ recurrence: 'DAILY' }), options);
      expect(result).toMatchObject({ ok: false, errors: { recurrence: 'invalid' } });
    });

    it('rejects a series longer than the occurrence cap', () => {
      const result = parseEventInput(
        raw({ recurrence: 'WEEKLY', recurrenceUntil: '2040-01-01' }),
        options,
      );
      expect(result).toEqual({ ok: false, errors: { recurrenceUntil: 'tooManyOccurrences' } });
    });
  });
});

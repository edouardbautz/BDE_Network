import { describe, expect, it } from 'vitest';
import { patternOf } from './explore-support';

describe('patternOf', () => {
  it('makes one kind of page of the pages of the same kind', () => {
    expect(patternOf('/en/events/qa-evt-0001', '?occ=1792602000000')).toBe('/en/events/:id?occ');
    expect(patternOf('/en/events/qa-evt-0002', '?occ=1')).toBe('/en/events/:id?occ');
    expect(patternOf('/en/roles/role-qa-treasurer', '')).toBe('/en/roles/:id');
  });

  it('keeps apart the pages that are not an event or a role of their own', () => {
    expect(patternOf('/en/events/new', '?date=2027-01-02')).toBe('/en/events/new?date');
    expect(patternOf('/en/events/review', '')).toBe('/en/events/review');
    expect(patternOf('/en/events/shared-calendar', '?status=on')).toBe(
      '/en/events/shared-calendar?status',
    );
    expect(patternOf('/en/roles/new', '')).toBe('/en/roles/new');
  });

  it('keeps the names of the query, sorted, and not its values', () => {
    expect(patternOf('/en/events', '?view=list&category=sport')).toBe('/en/events?category&view');
    expect(patternOf('/en/events', '?view=calendar&month=2027-01')).toBe('/en/events?month&view');
    expect(patternOf('/en/members', '')).toBe('/en/members');
  });
});

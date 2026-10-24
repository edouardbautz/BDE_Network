import { describe, expect, it } from 'vitest';
import {
  INTRA_KEYWORDS_LIMIT,
  INTRA_KINDS,
  groupedKinds,
  intraColumns,
  intraOf,
  normalizeKeywords,
  parseIntra,
  rawIntraOf,
  sameIntra,
  type RawIntra,
} from './intra';

const valid = (overrides: Partial<RawIntra> = {}): RawIntra => ({
  intraOrganizerLogin: 'Demo-President',
  intraAudience: 'BOTH',
  intraMaxPeople: '60',
  intraWaitingList: 'yes',
  intraKind: 'Meet/meet_up',
  intraUnsubscribeHours: '24',
  intraKeywords: ['bde', 'jeux'],
  ...overrides,
});

describe('parseIntra', () => {
  it('accepts a complete set and normalises it', () => {
    const result = parseIntra(
      valid({ intraKeywords: [' bde ', 'Jeux', 'JEUX', '', 'soirée, fête'] }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        organizerLogin: 'demo-president',
        audience: 'BOTH',
        maxPeople: 60,
        waitingList: true,
        kind: 'Meet/meet_up',
        unsubscribeHours: 24,
        keywords: ['bde', 'Jeux', 'soirée fête'],
      },
    });
  });

  it('reports every missing field at once', () => {
    const result = parseIntra(rawIntraOf(null, ''));
    expect(result).toEqual({
      ok: false,
      errors: {
        intraOrganizerLogin: 'required',
        intraAudience: 'required',
        intraMaxPeople: 'required',
        intraWaitingList: 'required',
        intraKind: 'required',
        intraUnsubscribeHours: 'required',
        intraKeywords: 'required',
      },
    });
  });

  it.each<[string, Partial<RawIntra>, keyof RawIntra, string]>([
    ['organizer with a space', { intraOrganizerLogin: 'a b' }, 'intraOrganizerLogin', 'invalid'],
    [
      'organizer too long',
      { intraOrganizerLogin: 'a'.repeat(31) },
      'intraOrganizerLogin',
      'tooLong',
    ],
    ['an audience that does not exist', { intraAudience: 'EVERYONE' }, 'intraAudience', 'invalid'],
    ['zero people', { intraMaxPeople: '0' }, 'intraMaxPeople', 'invalid'],
    ['a fraction of people', { intraMaxPeople: '2.5' }, 'intraMaxPeople', 'invalid'],
    ['too many people', { intraMaxPeople: '10001' }, 'intraMaxPeople', 'tooBig'],
    [
      'a waiting list neither yes nor no',
      { intraWaitingList: 'maybe' },
      'intraWaitingList',
      'invalid',
    ],
    ['a kind the intra does not have', { intraKind: 'Meet/party' }, 'intraKind', 'invalid'],
    ['a negative delay', { intraUnsubscribeHours: '-1' }, 'intraUnsubscribeHours', 'invalid'],
    ['a delay over a year', { intraUnsubscribeHours: '8761' }, 'intraUnsubscribeHours', 'tooBig'],
    ['a keyword too long', { intraKeywords: ['x'.repeat(41)] }, 'intraKeywords', 'tooLong'],
  ])('refuses %s', (_name, overrides, field, code) => {
    const result = parseIntra(valid(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBe(code);
  });

  it('refuses more keywords than the limit, and accepts exactly the limit', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`);
    expect(parseIntra(valid({ intraKeywords: words(INTRA_KEYWORDS_LIMIT) })).ok).toBe(true);
    const over = parseIntra(valid({ intraKeywords: words(INTRA_KEYWORDS_LIMIT + 1) }));
    expect(over.ok === false && over.errors.intraKeywords).toBe('tooMany');
  });

  it('accepts a delay of zero hours (unsubscribe up to the start) and the largest values', () => {
    const result = parseIntra(valid({ intraUnsubscribeHours: '0', intraMaxPeople: '10000' }));
    expect(result.ok).toBe(true);
  });

  it('offers every kind it accepts, and only those', () => {
    for (const kind of INTRA_KINDS) expect(parseIntra(valid({ intraKind: kind })).ok).toBe(true);
    expect(INTRA_KINDS).toHaveLength(11);
  });
});

describe('what an event row says about the intra', () => {
  const columns = intraColumns({
    organizerLogin: 'alice',
    audience: 'STUDENTS',
    maxPeople: 10,
    waitingList: false,
    kind: 'Association',
    unsubscribeHours: 0,
    keywords: ['a'],
  });

  it('round-trips through the columns', () => {
    const fields = intraOf(columns);
    expect(fields).not.toBeNull();
    expect(intraColumns(fields)).toEqual(columns);
    expect(rawIntraOf(columns, 'someone-else')).toMatchObject({
      intraOrganizerLogin: 'alice',
      intraWaitingList: 'no',
      intraUnsubscribeHours: '0',
    });
  });

  it('has nothing when a column is missing, even if the database refuses that', () => {
    expect(intraOf({ ...columns, intraKind: null })).toBeNull();
    expect(intraOf({ ...columns, intraKeywords: [] })).toBeNull();
    expect(intraOf({})).toBeNull();
    expect(intraColumns(null).intraKeywords).toEqual([]);
  });

  it('starts a new event with its author as organizer', () => {
    expect(rawIntraOf(null, 'alice').intraOrganizerLogin).toBe('alice');
  });

  it('compares sets, keywords in order', () => {
    const a = intraOf(columns);
    expect(sameIntra(a, intraOf(columns))).toBe(true);
    expect(sameIntra(a, null)).toBe(false);
    expect(sameIntra(null, null)).toBe(true);
    expect(sameIntra(a, intraOf({ ...columns, intraKeywords: ['b'] }))).toBe(false);
    expect(sameIntra(a, intraOf({ ...columns, intraMaxPeople: 11 }))).toBe(false);
  });
});

describe('keywords and kinds for the form', () => {
  it('drops commas (the intra takes a comma separated list) and repeats', () => {
    expect(normalizeKeywords(['a,b', 'A', 'a', '  c  d '])).toEqual(['a b', 'A', 'c d']);
  });

  it('groups the kinds by what comes before the slash', () => {
    const groups = groupedKinds();
    expect(groups.map((g) => g.group)).toEqual(['Pedago', 'Meet', null, 'Speed working', null]);
    expect(groups[1]?.kinds).toEqual([
      { value: 'Meet/Conference', label: 'Conference' },
      { value: 'Meet/meet_up', label: 'meet_up' },
      { value: 'Meet/event', label: 'event' },
    ]);
  });
});

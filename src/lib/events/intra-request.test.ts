import { describe, expect, it } from 'vitest';
import {
  canonicalContent,
  dateValues,
  diffContent,
  fieldValue,
  hashContent,
  intraDay,
  intraReadiness,
  intraTime,
  isEmptyChange,
  isOnIntra,
  needsStaff,
  parseIntraUrl,
  readContent,
  sameContent,
  type IntraContent,
  type IntraSource,
} from './intra-request';

const ZONE = 'Europe/Paris';

const INTRA = {
  intraOrganizerLogin: 'demo-president',
  intraAudience: 'BOTH' as const,
  intraMaxPeople: 60,
  intraWaitingList: true,
  intraKind: 'Meet/meet_up',
  intraUnsubscribeHours: 24,
  intraKeywords: ['bde', 'jeux'],
};

const OCT5 = new Date('2026-10-05T16:00:00Z');

function event(overrides: Partial<IntraSource> = {}): IntraSource {
  return {
    id: 'evt',
    title: 'Game night',
    description: 'Board games',
    location: 'Room B',
    categoryKey: 'sport',
    status: 'CONFIRMED',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + 2 * 3_600_000),
    repeat: null,
    recurrenceUntil: null,
    schoolYear: '2026-2027',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    assignees: [],
    cancellations: [],
    occurrences: [],
    ...INTRA,
    ...overrides,
  };
}

const weekly = (overrides: Partial<IntraSource> = {}) =>
  event({
    repeat: { freq: 'WEEKLY', interval: 1 },
    recurrenceUntil: new Date('2026-10-19T16:00:00Z'),
    ...overrides,
  });

const own = (start: string, values: Record<string, unknown> = {}) => ({
  occurrenceStart: new Date(start),
  title: null,
  description: null,
  location: null,
  categoryKey: null,
  status: null,
  startsAt: null,
  endsAt: null,
  assigneesOverridden: false,
  confirmationNotifiedAt: null,
  updatedAt: new Date('2026-09-02T00:00:00Z'),
  assignees: [],
  ...values,
});

function contentOf(source: IntraSource): IntraContent {
  const readiness = intraReadiness(source, ZONE);
  if (!readiness.ok) throw new Error(`not ready: ${readiness.reason}`);
  return readiness.content;
}

const words = {
  audience: (audience: string) => audience.toLowerCase(),
  waitingList: (value: boolean) => (value ? 'yes' : 'no'),
};

describe('what there is to publish for an event', () => {
  it('is its title, description, place, fields and dates', () => {
    expect(contentOf(event())).toEqual({
      title: 'Game night',
      description: 'Board games',
      location: 'Room B',
      fields: {
        organizerLogin: 'demo-president',
        audience: 'BOTH',
        maxPeople: 60,
        waitingList: true,
        kind: 'Meet/meet_up',
        unsubscribeHours: 24,
        keywords: ['bde', 'jeux'],
      },
      dates: [{ start: '2026-10-05T16:00:00.000Z', end: '2026-10-05T18:00:00.000Z' }],
    });
  });

  it('is nothing while the fields of the intra are missing', () => {
    expect(
      intraReadiness(
        event({
          intraOrganizerLogin: null,
          intraAudience: null,
          intraMaxPeople: null,
          intraWaitingList: null,
          intraKind: null,
          intraUnsubscribeHours: null,
          intraKeywords: [],
        }),
        ZONE,
      ),
    ).toEqual({ ok: false, reason: 'fieldsMissing' });
  });

  it.each(['DRAFT', 'PROPOSED'] as const)('is nothing for a %s', (status) => {
    expect(intraReadiness(event({ status }), ZONE)).toEqual({ ok: false, reason: 'notPublished' });
  });

  it('lists the dates of a series that are published and not cancelled, in order', () => {
    const source = weekly({
      cancellations: [{ occurrenceStart: new Date('2026-10-12T16:00:00Z') }],
    });
    expect(contentOf(source).dates.map((date) => date.start)).toEqual([
      '2026-10-05T16:00:00.000Z',
      '2026-10-19T16:00:00.000Z',
    ]);
  });

  it('leaves out the dates of a published series that went back to draft, and has only the date confirmed alone of a draft one', () => {
    const goneBack = weekly({
      occurrences: [own('2026-10-12T16:00:00Z', { status: 'DRAFT' })],
    });
    expect(contentOf(goneBack).dates).toHaveLength(2);

    const aloneConfirmed = weekly({
      status: 'DRAFT',
      occurrences: [own('2026-10-12T16:00:00Z', { status: 'CONFIRMED' })],
    });
    expect(contentOf(aloneConfirmed).dates.map((date) => date.start)).toEqual([
      '2026-10-12T16:00:00.000Z',
    ]);
  });

  it('is nothing once every date is cancelled', () => {
    const source = event({ cancellations: [{ occurrenceStart: OCT5 }] });
    expect(intraReadiness(source, ZONE)).toEqual({ ok: false, reason: 'notPublished' });
  });

  it('gives a date the values of its own only when they differ from the series’, and the moved time as it is', () => {
    const source = weekly({
      occurrences: [
        own('2026-10-12T16:00:00Z', {
          title: 'Tournament',
          location: 'Room B',
          startsAt: new Date('2026-10-12T17:00:00Z'),
          endsAt: new Date('2026-10-12T19:00:00Z'),
        }),
      ],
    });
    expect(contentOf(source).dates[1]).toEqual({
      start: '2026-10-12T17:00:00.000Z',
      end: '2026-10-12T19:00:00.000Z',
      title: 'Tournament',
    });
  });

  it('treats a missing description and place as empty text', () => {
    const content = contentOf(event({ description: null, location: null }));
    expect(content).toMatchObject({ description: '', location: '' });
  });
});

describe('the version of an event', () => {
  it('is the same for the same content, and a hash that is 64 hexadecimal characters', () => {
    expect(hashContent(contentOf(event()))).toBe(hashContent(contentOf(event())));
    expect(hashContent(contentOf(event()))).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['the title', { title: 'Other' }],
    ['the description', { description: 'Other' }],
    ['the place', { location: 'Other' }],
    ['the organizer', { intraOrganizerLogin: 'someone' }],
    ['the public', { intraAudience: 'STUDENTS' as const }],
    ['the size', { intraMaxPeople: 61 }],
    ['the waiting list', { intraWaitingList: false }],
    ['the kind', { intraKind: 'Association' }],
    ['the delay', { intraUnsubscribeHours: 25 }],
    ['the keywords', { intraKeywords: ['jeux', 'bde'] }],
    ['the start', { startsAt: new Date(OCT5.getTime() + 3_600_000) }],
    ['the end', { endsAt: new Date(OCT5.getTime() + 3 * 3_600_000) }],
  ])('changes with %s', (_what, change) => {
    expect(hashContent(contentOf(event(change)))).not.toBe(hashContent(contentOf(event())));
  });

  it.each([
    ['the category', { categoryKey: 'soiree' }],
    ['the members in charge', { assignees: [{ login: 'bob', user: null }] }],
    ['the last update', { updatedAt: new Date('2030-01-01T00:00:00Z') }],
  ])('does not change with %s (it is not on the intra)', (_what, change) => {
    expect(hashContent(contentOf(event(change)))).toBe(hashContent(contentOf(event())));
  });

  it('writes the content the same way whatever order its keys were built in', () => {
    const content = contentOf(event());
    const shuffled: IntraContent = {
      dates: content.dates,
      fields: { ...content.fields },
      location: content.location,
      description: content.description,
      title: content.title,
    };
    expect(canonicalContent(shuffled)).toBe(canonicalContent(content));
    expect(sameContent(shuffled, content)).toBe(true);
    expect(sameContent(null, content)).toBe(false);
    expect(sameContent(null, null)).toBe(true);
  });
});

describe('reading a content back from the database', () => {
  it('gives back what was stored', () => {
    const content = contentOf(
      weekly({ occurrences: [own('2026-10-12T16:00:00Z', { title: 'Tournament' })] }),
    );
    expect(readContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });

  it.each([
    ['null', null],
    ['a number', 3],
    ['a list', []],
    ['an object with nothing in it', {}],
  ])('refuses %s', (_what, value) => {
    expect(readContent(value)).toBeNull();
  });

  it('refuses a content with a wrong field, a kind the intra does not offer or a date that is not text', () => {
    const good = JSON.parse(JSON.stringify(contentOf(event())));
    expect(readContent(good)).not.toBeNull();
    expect(readContent({ ...good, title: 3 })).toBeNull();
    expect(readContent({ ...good, fields: { ...good.fields, kind: 'Meet/party' } })).toBeNull();
    expect(readContent({ ...good, fields: { ...good.fields, audience: 'ALL' } })).toBeNull();
    expect(readContent({ ...good, fields: { ...good.fields, keywords: [1] } })).toBeNull();
    expect(readContent({ ...good, dates: [{ start: 1, end: 2 }] })).toBeNull();
    expect(
      readContent({ ...good, dates: [{ start: 'a', end: 'b', title: { not: 'text' } }] }),
    ).toBeNull();
  });
});

describe('dates and times as the intra’s form takes them', () => {
  it('writes DD/MM/YYYY and HH:mm in the BDE’s zone, not in the language of the interface', () => {
    expect(intraDay('2026-10-05T16:00:00.000Z', ZONE)).toBe('05/10/2026');
    expect(intraTime('2026-10-05T16:00:00.000Z', ZONE)).toBe('18:00');
  });

  it('follows the change of clock: the same wall-clock hour on both sides', () => {
    expect(intraTime('2026-10-24T16:00:00.000Z', ZONE)).toBe('18:00'); // summer time
    expect(intraTime('2026-10-26T17:00:00.000Z', ZONE)).toBe('18:00'); // winter time
  });

  it('puts a date that the zone has already reached on the next day', () => {
    expect(intraDay('2026-12-31T23:30:00.000Z', ZONE)).toBe('01/01/2027');
    expect(intraTime('2026-12-31T23:30:00.000Z', ZONE)).toBe('00:30');
    expect(intraDay('2026-12-31T23:30:00.000Z', 'America/Los_Angeles')).toBe('31/12/2026');
  });

  it('gives the four values of a date', () => {
    expect(
      dateValues({ start: '2026-10-05T16:00:00.000Z', end: '2026-10-06T01:00:00.000Z' }, ZONE),
    ).toEqual({
      startDate: '05/10/2026',
      startTime: '18:00',
      endDate: '06/10/2026',
      endTime: '03:00',
    });
  });

  it('gives the fields that are not dates as text to copy', () => {
    const content = contentOf(event());
    expect(fieldValue(content, 'keywords', words)).toBe('bde, jeux');
    expect(fieldValue(content, 'availableFor', words)).toBe('both');
    expect(fieldValue(content, 'waitingList', words)).toBe('yes');
    expect(fieldValue(content, 'maxPeople', words)).toBe('60');
    expect(fieldValue(content, 'unsubscribeHours', words)).toBe('24');
    expect(fieldValue(content, 'name', words)).toBe('Game night');
    expect(fieldValue(content, 'organizerLogin', words)).toBe('demo-president');
    expect(fieldValue(content, 'kind', words)).toBe('Meet/meet_up');
  });
});

describe('what changed between what the intra holds and the event', () => {
  const base = contentOf(weekly());

  it('is nothing for the same content', () => {
    expect(isEmptyChange(diffContent(base, base, words))).toBe(true);
  });

  it('lists the fields that differ, with the old and the new value', () => {
    const after = contentOf(weekly({ title: 'Game night 2', intraMaxPeople: 80 }));
    const change = diffContent(base, after, words);
    expect(change.fields).toEqual([
      { field: 'name', before: 'Game night', after: 'Game night 2' },
      { field: 'maxPeople', before: '60', after: '80' },
    ]);
    expect(change.removed).toEqual([]);
    expect(change.added).toEqual([]);
  });

  it('lists the dates that went and the dates that came, a moved date being both', () => {
    const after = contentOf(
      weekly({
        cancellations: [{ occurrenceStart: new Date('2026-10-19T16:00:00Z') }],
        occurrences: [
          own('2026-10-12T16:00:00Z', {
            startsAt: new Date('2026-10-12T17:00:00Z'),
            endsAt: new Date('2026-10-12T19:00:00Z'),
          }),
        ],
      }),
    );
    const change = diffContent(base, after, words);
    expect(change.removed.map((date) => date.start)).toEqual([
      '2026-10-12T16:00:00.000Z',
      '2026-10-19T16:00:00.000Z',
    ]);
    expect(change.added.map((date) => date.start)).toEqual(['2026-10-12T17:00:00.000Z']);
    expect(isEmptyChange(change)).toBe(false);
  });

  it('lists a date that stays and whose own text changed', () => {
    const after = contentOf(
      weekly({ occurrences: [own('2026-10-12T16:00:00Z', { location: 'Pool' })] }),
    );
    const change = diffContent(base, after, words);
    expect(change.edited).toHaveLength(1);
    expect(change.edited[0]?.after).toMatchObject({ location: 'Pool' });
  });
});

describe('the link the staff may give', () => {
  it('accepts an https address of the intra and its sites, and writes it normalised', () => {
    expect(parseIntraUrl('https://profile.intra.42.fr/events/12')).toEqual({
      ok: true,
      value: 'https://profile.intra.42.fr/events/12',
    });
    expect(parseIntraUrl('  https://intra.42.fr  ')).toEqual({
      ok: true,
      value: 'https://intra.42.fr/',
    });
    expect(parseIntraUrl('HTTPS://Profile.Intra.42.fr/x?a=1#b')).toEqual({
      ok: true,
      value: 'https://profile.intra.42.fr/x?a=1#b',
    });
  });

  it('writes a space as the address does, so that nothing in the stored link can break out of it', () => {
    expect(parseIntraUrl('https://intra.42.fr/a b')).toEqual({
      ok: true,
      value: 'https://intra.42.fr/a%20b',
    });
    expect(parseIntraUrl('https://intra.42.fr/"><script>')).toEqual({
      ok: true,
      value: 'https://intra.42.fr/%22%3E%3Cscript%3E',
    });
  });

  it('is optional: blank, or not text, is no link', () => {
    expect(parseIntraUrl('')).toEqual({ ok: true, value: null });
    expect(parseIntraUrl('   ')).toEqual({ ok: true, value: null });
    expect(parseIntraUrl(undefined)).toEqual({ ok: true, value: null });
  });

  it.each([
    'http://profile.intra.42.fr/x',
    'ftp://intra.42.fr/x',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'https://evil.example/',
    'https://intra.42.fr.evil.example/',
    'https://evilintra.42.fr/',
    'https://notintra.42.fr.example',
    'https://user@intra.42.fr/',
    'https://user:pass@intra.42.fr/',
    'https://intra.42.fr:8443/',
    '//intra.42.fr/x',
    'intra.42.fr/x',
    `https://intra.42.fr/${'a'.repeat(300)}`,
  ])('refuses %s', (url) => {
    expect(parseIntraUrl(url)).toEqual({ ok: false });
  });

  it('refuses a "link" that is not text', () => {
    expect(parseIntraUrl({ href: 'https://intra.42.fr' })).toEqual({ ok: true, value: null });
    expect(parseIntraUrl(42)).toEqual({ ok: true, value: null });
  });
});

describe('the statuses', () => {
  it.each([
    ['PENDING', true, false],
    ['OUTDATED', true, true],
    ['PUBLISHED', false, true],
    ['REFUSED', false, false],
  ] as const)('%s waits for the staff: %s, is on the intra: %s', (status, waiting, onIntra) => {
    expect(needsStaff(status)).toBe(waiting);
    expect(isOnIntra(status)).toBe(onIntra);
  });
});

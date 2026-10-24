import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, memberWith } from '@/test/session-fixtures';

/**
 * The circuit of the requests to publish on the intra, end to end on the in-memory database (src/test/fake-events-db.ts): the
 * real actions on the events (which make the request and keep it in line with the event), the real answers of the staff, the
 * real audit entries and transactions. Only the session, the redirects and the notifications are doubles. The rules of the
 * pure parts are in lib/events/intra-request.test.ts.
 */

const { RedirectSignal, afterCallbacks } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  }
  return { RedirectSignal, afterCallbacks: [] as (() => unknown)[] };
});

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback);
  }),
}));
// What the staff, the author and the BDE room are told is held by intra-notifications.test.ts: here, only who is asked to tell, and when.
vi.mock('@/lib/events/intra-notifications', () => ({
  announceIntraOutcomes: vi.fn(async () => undefined),
  notifyIntraAnswered: vi.fn(async () => undefined),
  notifyIntraRequested: vi.fn(async () => undefined),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({
    href,
    locale,
  }: {
    href: string | { pathname: string; query?: Record<string, string | number> };
    locale: string;
  }) =>
    typeof href === 'string'
      ? `/${locale}${href}`
      : `/${locale}${href.pathname}${
          href.query
            ? `?${new URLSearchParams(Object.entries(href.query).map(([k, v]) => [k, String(v)]))}`
            : ''
        }`,
  redirect: vi.fn((options: { href: string | { pathname: string } }) => {
    throw new RedirectSignal(
      typeof options.href === 'string' ? options.href : options.href.pathname,
    );
  }),
}));
vi.mock('@/lib/events/notifications', () => ({
  notifyEventApproved: vi.fn(),
  notifyEventConfirmed: vi.fn(),
  notifyEventProposed: vi.fn(),
  notifyEventRefused: vi.fn(),
  notifyOccurrenceConfirmed: vi.fn(),
}));
vi.mock('@/lib/prisma', async () => {
  const { createFakeEventsDb } = await import('@/test/fake-events-db');
  const db = createFakeEventsDb();
  return { prisma: db.prisma, db };
});

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { db } = (await import('@/lib/prisma')) as unknown as {
  db: import('@/test/fake-events-db').FakeEventsDb;
};
const {
  cancelOccurrence,
  deleteEvent,
  deleteFollowingDates,
  restoreOccurrence,
  setEventStatus,
  updateEvent,
} = await import('./actions');
const { markIntraUpdated, publishOnIntra, refuseOnIntra, requestOnIntra } =
  await import('./intra/actions');
const { announceIntraOutcomes, notifyIntraAnswered, notifyIntraRequested } =
  await import('@/lib/events/intra-notifications');

const OCT5 = new Date('2026-10-05T16:00:00Z');
const OCT12 = new Date('2026-10-12T16:00:00Z');
const OCT19 = new Date('2026-10-19T16:00:00Z');

const INTRA = {
  intraOrganizerLogin: 'demo-president',
  intraAudience: 'BOTH',
  intraMaxPeople: 60,
  intraWaitingList: true,
  intraKind: 'Meet/meet_up',
  intraUnsubscribeHours: 24,
  intraKeywords: ['bde', 'jeux'],
};

function addEvent(overrides: Record<string, unknown> = {}) {
  db.add('event', {
    id: 'evt',
    title: 'Game night',
    description: 'Board games',
    location: 'Room B',
    categoryKey: 'sport',
    status: 'DRAFT',
    startsAt: OCT5,
    endsAt: new Date(OCT5.getTime() + 2 * 3_600_000),
    repeat: null,
    recurrenceUntil: null,
    schoolYear: '2026-2027',
    authorLogin: 'alice',
    ...INTRA,
    ...overrides,
  });
}

/** A weekly series of three Mondays (5, 12 and 19 October). */
const addSeries = (overrides: Record<string, unknown> = {}) =>
  addEvent({
    repeat: { freq: 'WEEKLY', interval: 1 },
    recurrenceUntil: new Date('2026-10-19T16:00:00Z'),
    ...overrides,
  });

function form(values: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  const defaults: Record<string, string | string[]> = {
    title: 'Game night',
    description: 'Board games',
    location: 'Room B',
    categoryKey: 'sport',
    startsAt: '2026-10-05T18:00',
    endsAt: '2026-10-05T20:00',
    repeat: 'NONE',
    repeatEnd: 'until',
    recurrenceUntil: '',
    status: 'CONFIRMED',
    assignees: [],
    intraOrganizerLogin: 'demo-president',
    intraAudience: 'BOTH',
    intraMaxPeople: '60',
    intraWaitingList: 'yes',
    intraKind: 'Meet/meet_up',
    intraUnsubscribeHours: '24',
    intraKeywords: ['bde', 'jeux'],
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

/** The form of the series, opened on the date at `day`. */
const seriesForm = (day: string, values: Record<string, string | string[]> = {}) =>
  form({
    repeat: 'WEEKLY',
    recurrenceUntil: '2026-10-19',
    startsAt: `${day}T18:00`,
    endsAt: `${day}T20:00`,
    ...values,
  });

const withScope = (data: FormData, scope: string, occurrence: Date): FormData => {
  data.set('scope', scope);
  data.set('occurrence', String(occurrence.getTime()));
  return data;
};

async function redirectOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.href;
    throw error;
  }
  throw new Error('expected a redirect');
}

const platform = (intraPublication: boolean) =>
  vi.mocked(getConfig).mockReturnValue({
    bde: { timezone: 'Europe/Paris' },
    modules: { enabled: ['events'] },
    events: {
      categories: [{ key: 'sport', label: 'Sport', color: '#16a34a' }],
      reminderHour: 18,
      intraPublication,
    },
  } as unknown as ReturnType<typeof getConfig>);

const signInAs = (permissions: string[], login: string) =>
  vi.mocked(getEffectiveSession).mockResolvedValue(effective(memberWith(permissions, login)));
const asValidator = () => signInAs(['events.view', 'events.validate'], 'real-actor');
const asStaff = () => signInAs(['events.intra_publish'], 'staff-sophie');

const requests = () => db.table('intraRequest');
const request = () => requests()[0];
const audit = () =>
  db.table('auditLog').map((entry) => ({ action: entry.action, ...(entry.metadata as object) }));
const lastAudit = () => audit().at(-1);
/** The version of the event the staff's page shows (kept by the sync in the request). */
const shownHash = () => String(request()!.contentHash);

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  db.reset();
  platform(true);
  asValidator();
});

describe('the request is made when the event is confirmed', () => {
  it('confirming a draft asks the staff, in the transaction of the confirmation, and the audit entry says so', async () => {
    addEvent();
    const target = await setEventStatus('evt', 'CONFIRMED');

    expect(target.href).toBe('/fr/events/evt');
    expect(requests()).toHaveLength(1);
    expect(request()).toMatchObject({
      eventId: 'evt',
      status: 'PENDING',
      requestedByLogin: 'real-actor',
      publishedContent: null,
    });
    expect(request()!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lastAudit()).toMatchObject({ action: 'event.status_change', intra: ['requested'] });
  });

  it('is made when a validator creates the event confirmed through the form', async () => {
    addEvent({ status: 'DRAFT' });
    await redirectOf(updateEvent('evt', {}, form({ status: 'CONFIRMED' })));
    expect(request()).toMatchObject({ eventId: 'evt', status: 'PENDING' });
  });

  it('is not made when the platform does not publish on the intra', async () => {
    platform(false);
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    expect(requests()).toEqual([]);
    expect(lastAudit()).not.toHaveProperty('intra');
  });

  it('is not made for an event that has none of the fields (it cannot be confirmed without them)', async () => {
    addEvent({
      intraOrganizerLogin: null,
      intraAudience: null,
      intraMaxPeople: null,
      intraWaitingList: null,
      intraKind: null,
      intraUnsubscribeHours: null,
      intraKeywords: [],
    });
    const target = await setEventStatus('evt', 'CONFIRMED');
    expect(target.href).toBe('/fr/events/evt?notice=intraFieldsMissing');
    expect(requests()).toEqual([]);
  });

  it('is not made by an edit of an event that was confirmed before and has none: somebody has to ask for it', async () => {
    addEvent({ status: 'CONFIRMED' });
    await redirectOf(updateEvent('evt', {}, form({ title: 'Game night 2' })));
    expect(requests()).toEqual([]);
    expect(lastAudit()).not.toHaveProperty('intra');
  });

  it('is not made again by confirming an event that already has one waiting', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    const before = request();
    await setEventStatus('evt', 'CONFIRMED');
    expect(requests()).toHaveLength(1);
    expect(request()).toEqual(before);
  });

  it('is one for the whole series, whichever date is confirmed first', async () => {
    addSeries();
    await setEventStatus('evt', 'CONFIRMED', OCT5.getTime(), 'following');
    expect(requests()).toHaveLength(1);
    expect(request()).toMatchObject({ eventId: 'evt', status: 'PENDING' });
  });

  it('a date confirmed alone makes a request for that date only', async () => {
    addSeries();
    await setEventStatus('evt', 'CONFIRMED', OCT12.getTime(), 'occurrence');
    expect(requests()).toHaveLength(1);
    const hashAlone = shownHash();

    // confirming the rest of the series changes what is asked (more dates), the request stays one
    await setEventStatus('evt', 'CONFIRMED', OCT5.getTime(), 'following');
    expect(requests()).toHaveLength(1);
    expect(shownHash()).not.toBe(hashAlone);
  });
});

describe('the request follows the event until the staff answers', () => {
  beforeEach(async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
  });

  it('a change made while it waits is just the new version: no outcome, still waiting', async () => {
    const before = shownHash();
    await redirectOf(updateEvent('evt', {}, form({ title: 'Game night 2' })));

    expect(request()).toMatchObject({ status: 'PENDING' });
    expect(shownHash()).not.toBe(before);
    expect(lastAudit()).toMatchObject({ action: 'event.update' });
    expect(lastAudit()).not.toHaveProperty('intra');
  });

  it('going back to draft takes the request back (nobody was told it was on the intra)', async () => {
    await setEventStatus('evt', 'DRAFT');
    expect(requests()).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: 'event.status_change', intra: ['withdrawn'] });
  });

  it('deleting the event takes it with it', async () => {
    await expect(deleteEvent('evt')).rejects.toBeInstanceOf(RedirectSignal);
    expect(requests()).toEqual([]);
    expect(db.table('event')).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: 'event.delete', intra: ['withdrawn'] });
  });
});

describe('an event that is on the intra and changes', () => {
  beforeEach(async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    asStaff();
    await publishOnIntra('evt', shownHash(), '');
    asValidator();
  });

  it('is "to update" with the old version kept, and says so in the audit entry', async () => {
    const published = request()!.publishedContent;
    expect(request()).toMatchObject({ status: 'PUBLISHED' });

    await redirectOf(updateEvent('evt', {}, form({ location: 'Room C' })));

    expect(request()).toMatchObject({ status: 'OUTDATED' });
    expect(request()!.publishedContent).toEqual(published);
    expect(lastAudit()).toMatchObject({ action: 'event.update', intra: ['changed'] });
  });

  it('a change that is undone leaves it published, with nothing to tell', async () => {
    await redirectOf(updateEvent('evt', {}, form({ location: 'Room C' })));
    await redirectOf(updateEvent('evt', {}, form({ location: 'Room B' })));

    expect(request()).toMatchObject({ status: 'PUBLISHED' });
    expect(lastAudit()).not.toHaveProperty('intra');
  });

  it('a change of the intra fields (the series’ own, not a date’s) makes it "to update" too', async () => {
    await redirectOf(updateEvent('evt', {}, form({ intraMaxPeople: '80' })));
    expect(request()).toMatchObject({ status: 'OUTDATED' });
  });

  it('a change that is not on the intra (the category, the members in charge) changes nothing', async () => {
    db.add('user', { id: 'u-bob', login: 'bob', fullName: 'Bob', status: 'MEMBER' });
    await redirectOf(updateEvent('evt', {}, form({ assignees: ['bob'] })));
    expect(request()).toMatchObject({ status: 'PUBLISHED' });
  });

  it('going back to draft takes it back, and the audit entry says it had been published', async () => {
    await setEventStatus('evt', 'DRAFT');
    expect(requests()).toEqual([]);
    expect(lastAudit()).toMatchObject({ intra: ['withdrawn'] });
  });

  it('deleting the event takes it back too', async () => {
    await expect(deleteEvent('evt')).rejects.toBeInstanceOf(RedirectSignal);
    expect(requests()).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: 'event.delete', intra: ['withdrawn'] });
  });
});

describe('a series that is on the intra', () => {
  beforeEach(async () => {
    addSeries();
    await setEventStatus('evt', 'CONFIRMED', OCT5.getTime(), 'following');
    asStaff();
    await publishOnIntra('evt', shownHash(), '');
    asValidator();
  });

  it('cancelling a date is a change of the list of dates: to update; restoring it undoes it', async () => {
    await cancelOccurrence('evt', OCT12.getTime());
    expect(request()).toMatchObject({ status: 'OUTDATED' });
    expect(lastAudit()).toMatchObject({ action: 'event.occurrence_cancel', intra: ['changed'] });

    await restoreOccurrence('evt', OCT12.getTime());
    expect(request()).toMatchObject({ status: 'PUBLISHED' });
  });

  it('moving one date alone makes it to update', async () => {
    const data = withScope(
      seriesForm('2026-10-12', { startsAt: '2026-10-12T19:00', endsAt: '2026-10-12T21:00' }),
      'occurrence',
      OCT12,
    );
    await redirectOf(updateEvent('evt', {}, data));
    expect(request()).toMatchObject({ status: 'OUTDATED' });
  });

  it('deleting this date and the following shortens the list: to update', async () => {
    await deleteFollowingDates('evt', OCT19.getTime());
    expect(request()).toMatchObject({ status: 'OUTDATED' });
    expect(lastAudit()).toMatchObject({ action: 'event.delete', intra: ['changed'] });
  });

  it('deleting every date takes the request back', async () => {
    await deleteFollowingDates('evt', OCT5.getTime());
    expect(requests()).toEqual([]);
    expect(lastAudit()).toMatchObject({ intra: ['withdrawn'] });
  });

  it('cutting the series carries the request on to the new row: both are to update, and the second one remembers what the intra holds', async () => {
    const data = withScope(
      seriesForm('2026-10-12', { title: 'Game night (new)' }),
      'following',
      OCT12,
    );
    await redirectOf(updateEvent('evt', {}, data));

    const rows = db.table('event');
    expect(rows).toHaveLength(2);
    const tail = rows.find((row) => row.id !== 'evt')!;
    expect(requests()).toHaveLength(2);
    expect(requests().find((row) => row.eventId === 'evt')).toMatchObject({ status: 'OUTDATED' });
    expect(requests().find((row) => row.eventId === tail.id)).toMatchObject({ status: 'OUTDATED' });
    // the second row's request holds the dates of the intra from the cut on (2 of the 3), the first row's all 3
    const dates = (row: Record<string, unknown>) =>
      (row.publishedContent as { dates: unknown[] }).dates.length;
    expect(dates(requests().find((row) => row.eventId === tail.id)!)).toBe(2);
    expect(dates(requests().find((row) => row.eventId === 'evt')!)).toBe(3);
  });
});

describe('what the staff answers', () => {
  beforeEach(async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    asStaff();
  });

  it('published: the request keeps a copy of what was published, the link, who and when, and the audit entry', async () => {
    const target = await publishOnIntra(
      'evt',
      shownHash(),
      'https://profile.intra.42.fr/events/12345',
    );

    expect(target.href).toBe('/fr/events/intra');
    expect(request()).toMatchObject({
      status: 'PUBLISHED',
      intraUrl: 'https://profile.intra.42.fr/events/12345',
      answeredByLogin: 'staff-sophie',
    });
    expect(request()!.publishedContent).toMatchObject({ title: 'Game night' });
    expect(lastAudit()).toMatchObject({
      action: 'intra.publish',
      dates: 1,
      url: 'https://profile.intra.42.fr/events/12345',
    });
  });

  it('refuses a link that is not an https address of the intra, without writing anything', async () => {
    for (const url of [
      'http://profile.intra.42.fr/x',
      'https://evil.example/intra.42.fr',
      'https://intra.42.fr.evil.example/',
      'https://user:pass@profile.intra.42.fr/',
      'javascript:alert(1)',
    ]) {
      await expect(publishOnIntra('evt', shownHash(), url)).rejects.toThrow('Invalid address');
    }
    expect(request()).toMatchObject({ status: 'PENDING' });
  });

  it('refuses an answer for a version the page did not show: the event changed meanwhile', async () => {
    const seen = shownHash();
    asValidator();
    await redirectOf(updateEvent('evt', {}, form({ title: 'Game night 2' })));
    asStaff();

    const target = await publishOnIntra('evt', seen, '');
    expect(target.href).toBe('/fr/events/intra/evt?notice=changedMeanwhile');
    expect(request()).toMatchObject({ status: 'PENDING' });
  });

  it('refuses a version that is not a hash, and an event that is not one', async () => {
    await expect(publishOnIntra('evt', 'nope', '')).rejects.toThrow('Invalid version');
    await expect(publishOnIntra('', shownHash(), '')).rejects.toThrow('Invalid event');
  });

  it('the first answer wins: a second one is a notice, and changes nothing', async () => {
    await publishOnIntra('evt', shownHash(), '');
    const before = request();
    const target = await refuseOnIntra('evt', 'Too late');
    expect(target.href).toBe('/fr/events/intra/evt?notice=alreadyAnswered');
    expect((await publishOnIntra('evt', shownHash(), '')).href).toBe(
      '/fr/events/intra/evt?notice=alreadyAnswered',
    );
    expect(request()).toEqual(before);
  });

  it('a request that is gone (the event went back to draft) is a notice', async () => {
    asValidator();
    await setEventStatus('evt', 'DRAFT');
    asStaff();
    expect((await refuseOnIntra('evt', 'No')).href).toBe('/fr/events/intra/evt?notice=gone');
  });

  it('refused: the comment is the reason (1 to 1000 characters), kept with who refused', async () => {
    await expect(refuseOnIntra('evt', '   ')).rejects.toThrow('Invalid comment');
    await expect(refuseOnIntra('evt', 'x'.repeat(1001))).rejects.toThrow('Invalid comment');

    await refuseOnIntra('evt', '  The room is not available.  ');
    expect(request()).toMatchObject({
      status: 'REFUSED',
      refusalComment: 'The room is not available.',
      answeredByLogin: 'staff-sophie',
    });
    expect(lastAudit()).toMatchObject({
      action: 'intra.refuse',
      comment: 'The room is not available.',
    });
  });

  it('"intra updated" brings the copy up to date, for the version the page showed', async () => {
    await publishOnIntra('evt', shownHash(), '');
    asValidator();
    await redirectOf(updateEvent('evt', {}, form({ location: 'Room C' })));
    asStaff();

    const stale = 'a'.repeat(64);
    expect((await markIntraUpdated('evt', stale)).href).toBe(
      '/fr/events/intra/evt?notice=changedMeanwhile',
    );
    expect(request()).toMatchObject({ status: 'OUTDATED' });

    await markIntraUpdated('evt', shownHash());
    expect(request()).toMatchObject({ status: 'PUBLISHED' });
    expect(request()!.publishedContent).toMatchObject({ location: 'Room C' });
    expect(lastAudit()).toMatchObject({ action: 'intra.update' });
  });

  it('"intra updated" on a request that is not to update is a notice', async () => {
    expect((await markIntraUpdated('evt', shownHash())).href).toBe(
      '/fr/events/intra/evt?notice=alreadyAnswered',
    );
  });
});

describe('sending a request again, or asking for one', () => {
  beforeEach(async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    asStaff();
    await refuseOnIntra('evt', 'Not on that day');
    asValidator();
  });

  it('a refused request goes back to waiting, with nothing left of the refusal, and the audit entry', async () => {
    const target = await requestOnIntra('evt', 'event');
    expect(target.href).toBe('/fr/events/evt');
    expect(request()).toMatchObject({
      status: 'PENDING',
      refusalComment: null,
      answeredByLogin: null,
      requestedByLogin: 'real-actor',
    });
    expect(lastAudit()).toMatchObject({ action: 'intra.request', resent: true });
  });

  it('one that waits is not sent twice', async () => {
    await requestOnIntra('evt', 'event');
    expect((await requestOnIntra('evt', 'event')).href).toBe(
      '/fr/events/evt?notice=alreadyRequested',
    );
    expect(requests()).toHaveLength(1);
  });

  it('an event that is confirmed and has no request can be asked for', async () => {
    db.reset();
    addEvent({ status: 'CONFIRMED' });
    const target = await requestOnIntra('evt', 'intra');
    expect(target.href).toBe('/fr/events/intra/evt');
    expect(request()).toMatchObject({ status: 'PENDING', requestedByLogin: 'real-actor' });
    expect(lastAudit()).toMatchObject({ action: 'intra.request', resent: false });
  });

  it('an event that is not published cannot be asked for', async () => {
    db.reset();
    addEvent({ status: 'DRAFT' });
    expect((await requestOnIntra('evt', 'event')).href).toBe(
      '/fr/events/evt?notice=notPublishable',
    );
    expect(requests()).toEqual([]);
  });

  it('comes back to a closed list of pages, never to an address', async () => {
    await expect(requestOnIntra('evt', 'https://evil.example')).rejects.toThrow('Invalid target');
  });
});

describe('who may do what', () => {
  beforeEach(async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
  });

  const answers = [
    ['publish', () => publishOnIntra('evt', shownHash(), '')],
    ['refuse', () => refuseOnIntra('evt', 'No')],
    ['update', () => markIntraUpdated('evt', shownHash())],
  ] as const;

  it.each(answers)(
    '%s: the staff only; a validator, a proposer and a member are refused',
    async (_name, answer) => {
      for (const [permissions, login] of [
        [['events.view', 'events.validate'], 'validator'],
        [['events.view', 'events.propose'], 'proposer'],
        [['events.view'], 'member'],
        [['events.intra_view'], 'follower'],
        [['events.intra_request'], 'requester'],
        [[], 'nobody'],
      ] as const) {
        signInAs([...permissions], login);
        await expect(answer()).rejects.toThrow('Forbidden');
      }
      expect(request()).toMatchObject({ status: 'PENDING' });
    },
  );

  it.each(answers)(
    '%s: refused to everybody while the platform does not publish on the intra',
    async (_name, answer) => {
      platform(false);
      asStaff();
      await expect(answer()).rejects.toThrow('Forbidden');
    },
  );

  it('asking: whoever holds the right to, and whoever validates; not the staff, not a follower', async () => {
    asStaff();
    await refuseOnIntra('evt', 'No');

    for (const [permissions, login] of [
      [['events.intra_publish'], 'staff-sophie'],
      [['events.intra_view'], 'follower'],
      [['events.view', 'events.propose'], 'proposer'],
      [[], 'nobody'],
    ] as const) {
      signInAs([...permissions], login);
      await expect(requestOnIntra('evt', 'event')).rejects.toThrow('Forbidden');
    }
    expect(request()).toMatchObject({ status: 'REFUSED' });

    signInAs(['events.intra_request'], 'requester');
    await requestOnIntra('evt', 'event');
    expect(request()).toMatchObject({ status: 'PENDING', requestedByLogin: 'requester' });
  });
});

describe('who is told, after the response', () => {
  const runAfter = async () => {
    for (const callback of afterCallbacks.splice(0)) await callback();
  };
  const outcomesAnnounced = () =>
    vi.mocked(announceIntraOutcomes).mock.calls.map(([outcomes]) => outcomes.map((o) => o.kind));

  it('confirming an event asks the staff, in the name of whoever confirmed', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    expect(announceIntraOutcomes).not.toHaveBeenCalled();
    await runAfter();

    expect(outcomesAnnounced()).toEqual([['requested']]);
    expect(vi.mocked(announceIntraOutcomes).mock.calls[0]![1]).toBe('real-actor');
  });

  it('a change to an event that is on the intra, and taking it back, tell the staff', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    asStaff();
    await publishOnIntra('evt', shownHash(), '');
    asValidator();
    afterCallbacks.length = 0;
    vi.mocked(announceIntraOutcomes).mockClear();

    await redirectOf(updateEvent('evt', {}, form({ location: 'Room C' })));
    await runAfter();
    expect(outcomesAnnounced()).toEqual([['changed']]);

    await setEventStatus('evt', 'DRAFT');
    await runAfter();
    expect(outcomesAnnounced()).toEqual([['changed'], ['withdrawn']]);
  });

  it('says nothing for a change that does not concern the intra', async () => {
    addEvent({ status: 'DRAFT' });
    await redirectOf(updateEvent('evt', {}, form({ status: 'DRAFT', title: 'Autre titre' })));
    await runAfter();
    expect(announceIntraOutcomes).not.toHaveBeenCalled();
  });

  it('tells the author and the BDE room when the staff publishes or refuses, and nobody when the staff only updates the intra', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    afterCallbacks.length = 0;
    asStaff();

    await publishOnIntra('evt', shownHash(), '');
    await runAfter();
    expect(notifyIntraAnswered).toHaveBeenCalledWith('published', 'evt', 'staff-sophie');

    asValidator();
    await redirectOf(updateEvent('evt', {}, form({ location: 'Room C' })));
    afterCallbacks.length = 0;
    asStaff();
    await markIntraUpdated('evt', shownHash());
    await runAfter();
    expect(notifyIntraAnswered).toHaveBeenCalledTimes(1);

    db.reset();
    addEvent();
    asValidator();
    await setEventStatus('evt', 'CONFIRMED');
    afterCallbacks.length = 0;
    asStaff();
    await refuseOnIntra('evt', 'Not on that day');
    await runAfter();
    expect(notifyIntraAnswered).toHaveBeenLastCalledWith('refused', 'evt', 'staff-sophie');
  });

  it('asks the staff again when a refused request is sent again, or asked for', async () => {
    addEvent({ status: 'CONFIRMED' });
    await requestOnIntra('evt', 'event');
    await runAfter();
    expect(notifyIntraRequested).toHaveBeenCalledWith('evt', 'real-actor');
  });

  it('says nothing of an answer that was not taken', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    afterCallbacks.length = 0;
    asStaff();
    await publishOnIntra('evt', 'a'.repeat(64), '');
    await refuseOnIntra('evt', 'x');
    await runAfter();
    expect(notifyIntraAnswered).toHaveBeenCalledTimes(1);
    expect(notifyIntraAnswered).toHaveBeenCalledWith('refused', 'evt', 'staff-sophie');
  });

  it('never lets a notification that fails undo or fail what was saved', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(announceIntraOutcomes).mockRejectedValueOnce(new Error('discord is down'));
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    await expect(runAfter()).resolves.toBeUndefined();
    expect(request()).toMatchObject({ status: 'PENDING' });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('why a request was taken back, as the staff is told', () => {
  const causes = () =>
    vi
      .mocked(announceIntraOutcomes)
      .mock.calls.flatMap(([outcomes]) =>
        outcomes.flatMap((outcome) => (outcome.kind === 'withdrawn' ? [outcome.cause] : [])),
      );
  const published = async (series = false) => {
    if (series) addSeries();
    else addEvent();
    await setEventStatus(
      'evt',
      'CONFIRMED',
      series ? OCT5.getTime() : undefined,
      series ? 'following' : undefined,
    );
    asStaff();
    await publishOnIntra('evt', shownHash(), '');
    asValidator();
    for (const callback of afterCallbacks.splice(0)) await callback();
    vi.mocked(announceIntraOutcomes).mockClear();
  };
  const runAfter = async () => {
    for (const callback of afterCallbacks.splice(0)) await callback();
  };

  it('back to draft', async () => {
    await published();
    await setEventStatus('evt', 'DRAFT');
    await runAfter();
    expect(causes()).toEqual(['draft']);
  });

  it('the event deleted', async () => {
    await published();
    await expect(deleteEvent('evt')).rejects.toBeInstanceOf(RedirectSignal);
    await runAfter();
    expect(causes()).toEqual(['deleted']);
  });

  it('the last confirmed date of a series cancelled: no date left, not a draft', async () => {
    await published(true);
    for (const date of [OCT5, OCT12, OCT19]) await cancelOccurrence('evt', date.getTime());
    await runAfter();
    expect(causes()).toEqual(['dates']);
  });

  it('is not told for a request that was never on the intra', async () => {
    addEvent();
    await setEventStatus('evt', 'CONFIRMED');
    await runAfter();
    vi.mocked(announceIntraOutcomes).mockClear();
    await setEventStatus('evt', 'DRAFT');
    await runAfter();
    // the outcome is there (the request is gone), but it carries nothing that was published
    const outcomes = vi.mocked(announceIntraOutcomes).mock.calls.flatMap(([list]) => list);
    expect(outcomes).toMatchObject([{ kind: 'withdrawn', cause: 'draft', published: null }]);
  });
});

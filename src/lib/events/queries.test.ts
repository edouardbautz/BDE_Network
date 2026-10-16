import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the queries ask the database, since the draft rules depend on it: a reader who cannot see drafts must not be
 * handed a draft event, but must get a draft event's dates that were confirmed on their own. (expandEvents decides
 * again, date by date, which is tested with the feeds.)
 */

vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ bde: { timezone: 'Europe/Paris' } })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { prisma } = await import('@/lib/prisma');
const { getFilterOptions, getVisibleEvent, listOccurrences } = await import('./queries');

const RANGE = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
const CONFIRMED_ALONE = { occurrences: { some: { status: 'CONFIRMED' } } };

const whereOf = (call: number) =>
  JSON.stringify(vi.mocked(prisma.event.findMany).mock.calls[call]?.[0]?.where);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.findMany).mockResolvedValue([]);
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
});

describe('listOccurrences', () => {
  it('asks a reader who cannot see drafts only for confirmed events and events with a date confirmed alone', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: false });

    expect(whereOf(0)).toContain(
      JSON.stringify({ OR: [{ status: 'CONFIRMED' }, CONFIRMED_ALONE] }),
    );
  });

  it('also asks somebody who only proposes for their own events, whatever their status', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: false, ownLogin: 'dave' });

    expect(whereOf(0)).toContain(
      JSON.stringify({
        OR: [{ OR: [{ status: 'CONFIRMED' }, CONFIRMED_ALONE] }, { authorLogin: 'dave' }],
      }),
    );
  });

  it('asks nobody but a proposer for the events of an author', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: false });
    expect(whereOf(0)).not.toContain('authorLogin');

    vi.clearAllMocks();
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    await listOccurrences({ range: RANGE, includeDrafts: true, ownLogin: 'dave' });
    expect(whereOf(0)).not.toContain('authorLogin');
  });

  it('puts no such condition for somebody who manages the events', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: true });

    expect(whereOf(0)).not.toContain('"status":"CONFIRMED"');
  });

  it('also fetches the events that have a date moved into the window', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: true });

    expect(whereOf(0)).toContain('"occurrences":{"some":{"startsAt":{"lt":');
  });

  it('reads the dates that have values of their own along with the events', async () => {
    await listOccurrences({ range: RANGE, includeDrafts: true });

    const { include } = vi.mocked(prisma.event.findMany).mock.calls[0]![0]!;
    expect(include).toHaveProperty('occurrences');
    expect(include).toHaveProperty('cancellations');
  });

  it('keeps the events whose category or members can match, since a date can have its own', async () => {
    await listOccurrences({
      range: RANGE,
      includeDrafts: true,
      filters: { categoryKey: 'sport', assigneeLogin: 'alice' },
    });

    const where = whereOf(0);
    expect(where).toContain('"categoryKey":"sport"');
    expect(where).toContain('"occurrences":{"some":{"categoryKey":"sport"}}');
    expect(where).toContain('"login":"alice"');
  });
});

describe('getVisibleEvent', () => {
  const event = (
    status: 'DRAFT' | 'PROPOSED' | 'CONFIRMED',
    own: { status: 'DRAFT' | 'PROPOSED' | 'CONFIRMED' | null }[] = [],
    authorLogin = 'pol',
  ) => ({ id: 'evt1', status, authorLogin, occurrences: own }) as never;

  it('is null for an event that does not exist', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    expect(await getVisibleEvent('evt1', { includeDrafts: true })).toBeNull();
  });

  it('is null for a draft, for a reader who cannot see drafts: as if it did not exist', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT'));
    expect(await getVisibleEvent('evt1', { includeDrafts: false })).toBeNull();
    // A date back to draft or a date with other values of its own does not make it visible.
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      event('DRAFT', [{ status: 'DRAFT' }, { status: null }]),
    );
    expect(await getVisibleEvent('evt1', { includeDrafts: false })).toBeNull();
  });

  it('is the event for a draft that has a date confirmed on its own (the page shows that date only)', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT', [{ status: 'CONFIRMED' }]));
    expect(await getVisibleEvent('evt1', { includeDrafts: false })).toMatchObject({ id: 'evt1' });
  });

  it('is the event, drafts and proposals included, for a validator; and a confirmed event for everybody', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT'));
    expect(await getVisibleEvent('evt1', { includeDrafts: true })).toMatchObject({ id: 'evt1' });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('PROPOSED'));
    expect(await getVisibleEvent('evt1', { includeDrafts: true })).toMatchObject({ id: 'evt1' });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('CONFIRMED'));
    expect(await getVisibleEvent('evt1', { includeDrafts: false })).toMatchObject({ id: 'evt1' });
  });

  it('is null for a proposal, for a reader who cannot see what is not published', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('PROPOSED'));
    expect(await getVisibleEvent('evt1', { includeDrafts: false })).toBeNull();
  });

  it('is the event, whatever its status, for its own author who only proposes', async () => {
    const viewer = { includeDrafts: false, ownLogin: 'pol' };
    for (const status of ['DRAFT', 'PROPOSED', 'CONFIRMED'] as const) {
      vi.mocked(prisma.event.findUnique).mockResolvedValue(event(status));
      expect(await getVisibleEvent('evt1', viewer)).toMatchObject({ id: 'evt1' });
    }
  });

  it("is null for somebody else's draft or proposal, for a proposer", async () => {
    const viewer = { includeDrafts: false, ownLogin: 'other' };
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT'));
    expect(await getVisibleEvent('evt1', viewer)).toBeNull();
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('PROPOSED'));
    expect(await getVisibleEvent('evt1', viewer)).toBeNull();
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('CONFIRMED'));
    expect(await getVisibleEvent('evt1', viewer)).toMatchObject({ id: 'evt1' });
  });
});

describe('getFilterOptions', () => {
  it('offers a reader who cannot see drafts the school years of what they can see', async () => {
    await getFilterOptions({ includeDrafts: false });
    expect(whereOf(0)).toBe(JSON.stringify({ OR: [{ status: 'CONFIRMED' }, CONFIRMED_ALONE] }));

    vi.clearAllMocks();
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await getFilterOptions({ includeDrafts: true });
    expect(whereOf(0)).toBe('{}');

    vi.clearAllMocks();
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await getFilterOptions({ includeDrafts: false, ownLogin: 'dave' });
    expect(whereOf(0)).toContain('"authorLogin":"dave"');
  });
});

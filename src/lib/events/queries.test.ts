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
    status: 'DRAFT' | 'CONFIRMED',
    own: { status: 'DRAFT' | 'CONFIRMED' | null }[] = [],
  ) => ({ id: 'evt1', status, occurrences: own }) as never;

  it('is null for an event that does not exist', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    expect(await getVisibleEvent('evt1', true)).toBeNull();
  });

  it('is null for a draft, for a reader who cannot see drafts: as if it did not exist', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT'));
    expect(await getVisibleEvent('evt1', false)).toBeNull();
    // A date back to draft or a date with other values of its own does not make it visible.
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      event('DRAFT', [{ status: 'DRAFT' }, { status: null }]),
    );
    expect(await getVisibleEvent('evt1', false)).toBeNull();
  });

  it('is the event for a draft that has a date confirmed on its own (the page shows that date only)', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT', [{ status: 'CONFIRMED' }]));
    expect(await getVisibleEvent('evt1', false)).toMatchObject({ id: 'evt1' });
  });

  it('is the event, drafts included, for somebody who manages events; and a confirmed event for everybody', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('DRAFT'));
    expect(await getVisibleEvent('evt1', true)).toMatchObject({ id: 'evt1' });
    vi.mocked(prisma.event.findUnique).mockResolvedValue(event('CONFIRMED'));
    expect(await getVisibleEvent('evt1', false)).toMatchObject({ id: 'evt1' });
  });
});

describe('getFilterOptions', () => {
  it('offers a reader who cannot see drafts the school years of what they can see', async () => {
    await getFilterOptions(false);
    expect(whereOf(0)).toBe(JSON.stringify({ OR: [{ status: 'CONFIRMED' }, CONFIRMED_ALONE] }));

    vi.clearAllMocks();
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await getFilterOptions(true);
    expect(whereOf(0)).toBe('{}');
  });
});

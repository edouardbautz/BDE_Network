import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OccurrenceView } from './occurrences';

/**
 * The BDE-wide feed against an in-memory stand-in for the singleton row, so
 * enable / regenerate / disable are exercised as a sequence: what matters is
 * which token resolves after each step.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('./queries', () => ({ listOccurrences: vi.fn() }));

const store = vi.hoisted(() => ({ row: null as { id: string; token: string | null } | null }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bdeCalendarFeed: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; token?: string } }) => {
        const row = store.row;
        if (!row) return null;
        if (where.id !== undefined) return where.id === row.id ? row : null;
        return where.token !== undefined && where.token === row.token ? row : null;
      }),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: { id: string; token?: string };
          update: { token?: string };
        }) => {
          store.row = store.row
            ? { ...store.row, ...update }
            : { id: create.id, token: create.token ?? null };
          return store.row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; token?: null };
          data: { token: string | null };
        }) => {
          const row = store.row;
          if (!row || row.id !== where.id) return { count: 0 };
          if (where.token === null && row.token !== null) return { count: 0 };
          row.token = data.token;
          return { count: 1 };
        },
      ),
    },
  },
}));

const { getConfig } = await import('@/config');
const { listOccurrences } = await import('./queries');
const {
  buildBdeSubscriptionFeed,
  disableBdeFeed,
  enableBdeFeed,
  getBdeFeedToken,
  regenerateBdeFeed,
  CALENDAR_TOKEN_PATTERN,
} = await import('./export');

const NOW = new Date('2026-10-01T10:00:00Z');

function setModule(enabled: boolean) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', timezone: 'Europe/Paris' },
    modules: { enabled: enabled ? ['events'] : [] },
    events: { categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }] },
  } as unknown as ReturnType<typeof getConfig>);
}

function occurrence(title: string, status: 'DRAFT' | 'CONFIRMED'): OccurrenceView {
  return {
    key: `${title}:1`,
    eventId: `id-${title}`,
    title,
    description: null,
    location: null,
    categoryKey: 'soiree',
    status,
    start: new Date('2026-10-10T18:00:00Z'),
    end: new Date('2026-10-10T20:00:00Z'),
    isRecurring: false,
    schoolYear: '2026-2027',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    assignees: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.row = null;
  setModule(true);
  vi.mocked(listOccurrences).mockResolvedValue([]);
});

describe('BDE feed lifecycle', () => {
  it('is off until someone turns it on', async () => {
    await expect(getBdeFeedToken()).resolves.toBeNull();
  });

  it('enabling creates a well-formed token and serves the feed with it', async () => {
    const token = await enableBdeFeed();
    expect(token).toMatch(CALENDAR_TOKEN_PATTERN);
    await expect(getBdeFeedToken()).resolves.toBe(token);
    await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.toContain('BEGIN:VCALENDAR');
  });

  it('enabling twice keeps the same link (idempotent)', async () => {
    const first = await enableBdeFeed();
    const second = await enableBdeFeed();
    expect(second).toBe(first);
  });

  it('regenerating makes the previous link a 404 at once and the new one work', async () => {
    const oldToken = await enableBdeFeed();
    const newToken = await regenerateBdeFeed();

    expect(newToken).not.toBe(oldToken);
    expect(newToken).toMatch(CALENDAR_TOKEN_PATTERN);
    await expect(buildBdeSubscriptionFeed(oldToken, NOW)).resolves.toBeNull();
    await expect(buildBdeSubscriptionFeed(newToken, NOW)).resolves.toContain('BEGIN:VCALENDAR');
  });

  it('regenerating also works when the feed was never enabled', async () => {
    const token = await regenerateBdeFeed();
    await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.not.toBeNull();
  });

  it('disabling makes the link a 404 at once', async () => {
    const token = await enableBdeFeed();
    await disableBdeFeed();

    await expect(getBdeFeedToken()).resolves.toBeNull();
    await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.toBeNull();
  });

  it('can be turned back on after being disabled, with a different link', async () => {
    const first = await enableBdeFeed();
    await disableBdeFeed();
    const second = await enableBdeFeed();
    expect(second).not.toBe(first);
    await expect(buildBdeSubscriptionFeed(first, NOW)).resolves.toBeNull();
    await expect(buildBdeSubscriptionFeed(second, NOW)).resolves.not.toBeNull();
  });
});

describe('buildBdeSubscriptionFeed', () => {
  it('rejects an unknown token', async () => {
    await enableBdeFeed();
    await expect(buildBdeSubscriptionFeed('A'.repeat(43), NOW)).resolves.toBeNull();
  });

  it.each(['', 'short', `${'A'.repeat(42)}!`, '../../etc/passwd'])(
    'rejects a malformed token %j without touching the database',
    async (token) => {
      await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.toBeNull();
    },
  );

  it('returns nothing when the events module is disabled, even with a valid token', async () => {
    const token = await enableBdeFeed();
    setModule(false);
    await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.toBeNull();
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('never asks for drafts', async () => {
    const token = await enableBdeFeed();
    await buildBdeSubscriptionFeed(token, NOW);
    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: false }));
  });

  it('contains confirmed events only, even if a draft slipped through the query', async () => {
    const token = await enableBdeFeed();
    vi.mocked(listOccurrences).mockResolvedValue([
      occurrence('Confirmé', 'CONFIRMED'),
      occurrence('Brouillon secret', 'DRAFT'),
    ]);

    const feed = await buildBdeSubscriptionFeed(token, NOW);

    expect(feed).toContain('SUMMARY:Confirmé');
    expect(feed).not.toContain('Brouillon secret');
    expect(feed).not.toContain('TENTATIVE');
  });

  it('is named after the BDE', async () => {
    const token = await enableBdeFeed();
    await expect(buildBdeSubscriptionFeed(token, NOW)).resolves.toContain('X-WR-CALNAME:BDE Test');
  });
});

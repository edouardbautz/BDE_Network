import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import type { OccurrenceView } from './occurrences';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('./queries', () => ({ listOccurrences: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    modulePermission: { findMany: vi.fn() },
  },
}));

const { getConfig } = await import('@/config');
const { prisma } = await import('@/lib/prisma');
const { listOccurrences } = await import('./queries');
const {
  CALENDAR_TOKEN_PATTERN,
  buildSubscriptionFeed,
  ensureCalendarToken,
  generateCalendarToken,
  regenerateCalendarToken,
} = await import('./export');

const TOKEN = 'A'.repeat(43);
const NOW = new Date('2026-10-01T10:00:00Z');

function setConfig(enabled = true) {
  vi.mocked(getConfig).mockReturnValue({
    bde: { name: 'BDE Test', timezone: 'Europe/Paris' },
    modules: { enabled: enabled ? ['events'] : [] },
    events: { categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }] },
  } as unknown as ReturnType<typeof getConfig>);
}

function owner(role: Role, granted: string[] = []) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', role } as never);
  vi.mocked(prisma.modulePermission.findMany).mockResolvedValue(
    granted.map((module) => ({ module })) as never,
  );
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
  setConfig();
  vi.mocked(listOccurrences).mockResolvedValue([]);
});

describe('generateCalendarToken', () => {
  it('produces unguessable, URL-safe 43-character tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateCalendarToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(CALENDAR_TOKEN_PATTERN);
  });
});

describe('buildSubscriptionFeed — who may read the feed', () => {
  it.each(['', 'short', `${'A'.repeat(42)}!`, `${TOKEN}x`, '../../etc/passwd'])(
    'rejects a malformed token %j without querying the database',
    async (token) => {
      await expect(buildSubscriptionFeed(token, NOW)).resolves.toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('returns nothing when the events module is disabled', async () => {
    setConfig(false);
    owner('OWNER');
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toBeNull();
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('returns nothing for an unknown token', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toBeNull();
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('loses access the moment the member is removed (their row, and token, are gone)', async () => {
    owner('MEMBER');
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toContain('BEGIN:VCALENDAR');

    // Removing a member deletes the User row; the token no longer resolves.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toBeNull();
  });

  it('returns nothing for an account that is not approved', async () => {
    owner('PENDING', ['events']);
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toBeNull();
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('looks the owner up by the exact token', async () => {
    owner('MEMBER');
    await buildSubscriptionFeed(TOKEN, NOW);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { calendarToken: TOKEN },
      select: { id: true, role: true },
    });
  });
});

describe('buildSubscriptionFeed — which events it exposes', () => {
  it('excludes drafts for a member without the events permission', async () => {
    owner('MEMBER');
    await buildSubscriptionFeed(TOKEN, NOW);
    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: false }));
  });

  it('excludes drafts for an admin who only holds another module', async () => {
    owner('ADMIN', ['finance']);
    await buildSubscriptionFeed(TOKEN, NOW);
    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: false }));
  });

  it('includes drafts for a member with the events permission', async () => {
    owner('MEMBER', ['events']);
    await buildSubscriptionFeed(TOKEN, NOW);
    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: true }));
  });

  it('includes drafts for the owner', async () => {
    owner('OWNER');
    await buildSubscriptionFeed(TOKEN, NOW);
    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: true }));
  });

  it('re-evaluates the permission on every request (revocation is immediate)', async () => {
    owner('MEMBER', ['events']);
    await buildSubscriptionFeed(TOKEN, NOW);
    owner('MEMBER', []);
    await buildSubscriptionFeed(TOKEN, NOW);

    const calls = vi.mocked(listOccurrences).mock.calls;
    expect(calls[0]?.[0].includeDrafts).toBe(true);
    expect(calls[1]?.[0].includeDrafts).toBe(false);
  });

  it('renders the occurrences as an iCalendar feed, drafts marked tentative', async () => {
    owner('OWNER');
    vi.mocked(listOccurrences).mockResolvedValue([
      occurrence('Confirmé', 'CONFIRMED'),
      occurrence('Brouillon', 'DRAFT'),
    ]);
    const feed = await buildSubscriptionFeed(TOKEN, NOW);

    expect(feed).toContain('X-WR-CALNAME:BDE Test');
    expect(feed).toContain('SUMMARY:Confirmé');
    expect(feed).toContain('STATUS:CONFIRMED');
    expect(feed).toContain('SUMMARY:Brouillon');
    expect(feed).toContain('STATUS:TENTATIVE');
    expect(feed).toContain('CATEGORIES:Soirée');
  });

  it('queries a window around now', async () => {
    owner('MEMBER');
    await buildSubscriptionFeed(TOKEN, NOW);
    const { range } = vi.mocked(listOccurrences).mock.calls[0]![0];
    expect(range.from.getTime()).toBeLessThan(NOW.getTime());
    expect(range.to.getTime()).toBeGreaterThan(NOW.getTime() + 365 * 86_400_000);
  });
});

describe('ensureCalendarToken / regenerateCalendarToken', () => {
  it('returns the existing token without writing', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ calendarToken: TOKEN } as never);
    await expect(ensureCalendarToken('u1')).resolves.toBe(TOKEN);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('creates a token on first use, only filling an empty slot', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ calendarToken: null } as never);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });

    const token = await ensureCalendarToken('u1');

    expect(token).toMatch(CALENDAR_TOKEN_PATTERN);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', calendarToken: null },
      data: { calendarToken: token },
    });
  });

  it('agrees with a concurrent first visit instead of overwriting its token', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow)
      .mockResolvedValueOnce({ calendarToken: null } as never)
      .mockResolvedValueOnce({ calendarToken: TOKEN } as never);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 });

    await expect(ensureCalendarToken('u1')).resolves.toBe(TOKEN);
  });

  it('regenerating stores a brand new token, invalidating the old link', async () => {
    const fresh = await regenerateCalendarToken('u1');
    expect(fresh).toMatch(CALENDAR_TOKEN_PATTERN);
    expect(fresh).not.toBe(TOKEN);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { calendarToken: fresh },
    });

    // The old token no longer resolves to anyone.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(buildSubscriptionFeed(TOKEN, NOW)).resolves.toBeNull();
  });
});

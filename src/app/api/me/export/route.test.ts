import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUniqueOrThrow: vi.fn() },
    modulePermission: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    eventAssignee: { findMany: vi.fn() },
  },
}));

const { auth } = await import('@/lib/auth');
const { prisma } = await import('@/lib/prisma');
const { GET } = await import('./route');

const mockAuth = vi.mocked(auth as () => Promise<{ user: { id: string } } | null>);
const SECRET = 'S'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'u1' } });
  vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
    login: 'alice',
    fullName: 'Alice A',
    calendarToken: SECRET,
  } as never);
  vi.mocked(prisma.modulePermission.findMany).mockResolvedValue([]);
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
  vi.mocked(prisma.event.findMany).mockResolvedValue([{ title: 'Tournoi' }] as never);
  vi.mocked(prisma.eventAssignee.findMany).mockResolvedValue([
    { event: { title: 'Soirée', startsAt: new Date('2026-10-10T18:00:00Z') } },
  ] as never);
});

describe('GET /api/me/export', () => {
  it('refuses anonymous requests', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("includes the member's events data but never the secret calendar token", async () => {
    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.events.authored).toEqual([{ title: 'Tournoi' }]);
    expect(body.events.inChargeOf).toEqual([
      { title: 'Soirée', startsAt: '2026-10-10T18:00:00.000Z' },
    ]);
    expect(body.calendarFeedActive).toBe(true);
    expect(text).not.toContain(SECRET);
    expect(body.user).not.toHaveProperty('calendarToken');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveFor } from '@/test/session-fixtures';

vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUniqueOrThrow: vi.fn() },
    auditLog: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    eventAssignee: { findMany: vi.fn() },
    eventOccurrenceAssignee: { findMany: vi.fn() },
    eventCancellation: { findMany: vi.fn() },
    notificationTemplate: { findMany: vi.fn() },
    notificationTemplateVersion: { findMany: vi.fn() },
    notificationMention: { findMany: vi.fn() },
    intraRequest: { findMany: vi.fn() },
  },
}));

const { getEffectiveSession } = await import('@/lib/auth/session');
const { prisma } = await import('@/lib/prisma');
const { GET } = await import('./route');

const mockSession = vi.mocked(getEffectiveSession);
const SECRET = 'S'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue(effectiveFor('MEMBER', 'alice', 'u1'));
  vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
    login: 'alice',
    fullName: 'Alice A',
    status: 'MEMBER',
    role: { name: 'Membre' },
    calendarToken: SECRET,
  } as never);
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
  vi.mocked(prisma.intraRequest.findMany).mockResolvedValue([]);
  vi.mocked(prisma.event.findMany).mockImplementation((async (args: {
    where: Record<string, unknown>;
  }) =>
    'refusedByLogin' in args.where
      ? [
          {
            title: 'Soirée trop tardive',
            refusedAt: new Date('2026-10-01T10:00:00Z'),
            refusalComment: 'Pendant les examens.',
          },
        ]
      : [{ title: 'Tournoi' }]) as never);
  vi.mocked(prisma.eventOccurrenceAssignee.findMany).mockResolvedValue([
    { occurrence: { occurrenceStart: new Date('2026-11-04T19:00:00Z'), event: { title: 'Jeux' } } },
  ] as never);
  vi.mocked(prisma.eventCancellation.findMany).mockResolvedValue([
    {
      occurrenceStart: new Date('2026-11-11T19:00:00Z'),
      createdAt: new Date('2026-11-10T09:00:00Z'),
      event: { title: 'Jeux' },
    },
  ] as never);
  vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([
    {
      type: 'eventConfirmed',
      scope: 'discord',
      version: 3,
      updatedAt: new Date('2026-10-20T10:00:00Z'),
    },
  ] as never);
  vi.mocked(prisma.notificationTemplateVersion.findMany).mockResolvedValue([
    {
      type: 'eventConfirmed',
      scope: 'discord',
      version: 3,
      action: 'save',
      createdAt: new Date('2026-10-20T10:00:00Z'),
    },
  ] as never);
  vi.mocked(prisma.notificationMention.findMany).mockResolvedValue([
    {
      platform: 'discord',
      kind: 'role',
      key: 'bureau',
      label: 'Bureau',
      createdAt: new Date('2026-10-19T10:00:00Z'),
    },
  ] as never);
  vi.mocked(prisma.eventAssignee.findMany).mockResolvedValue([
    { event: { title: 'Soirée', startsAt: new Date('2026-10-10T18:00:00Z') } },
  ] as never);
});

describe('GET /api/me/export', () => {
  it('refuses anonymous requests', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('is never kept by a cache, whether it answers or refuses', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET()).headers.get('cache-control')).toBe('private, no-store');

    mockSession.mockResolvedValue(effectiveFor('MEMBER', 'alice', 'u1'));
    expect((await GET()).headers.get('cache-control')).toBe('private, no-store');
  });

  it('lists what the member did to the notifications, and only that: never what a template says', async () => {
    const body = JSON.parse(await (await GET()).text());

    expect(body.notifications.templatesEdited).toEqual([
      {
        type: 'eventConfirmed',
        scope: 'discord',
        version: 3,
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
    ]);
    expect(body.notifications.templateVersions[0]).toMatchObject({ action: 'save', version: 3 });
    expect(body.notifications.mentionsAdded).toEqual([
      {
        platform: 'discord',
        kind: 'role',
        key: 'bureau',
        label: 'Bureau',
        createdAt: '2026-10-19T10:00:00.000Z',
      },
    ]);
    // every query is made for this account alone
    expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { updatedById: 'u1' } }),
    );
    expect(prisma.notificationTemplateVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: 'u1' } }),
    );
    expect(prisma.notificationMention.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdByLogin: 'alice' } }),
    );
    expect(JSON.stringify(body)).not.toContain('"content"');
  });

  it('lists the requests for the intra the member sent and those they answered, each for this account alone', async () => {
    vi.mocked(prisma.intraRequest.findMany).mockImplementation((async (args: {
      where: Record<string, unknown>;
    }) =>
      'requestedById' in args.where
        ? [
            {
              status: 'PENDING',
              requestedAt: new Date('2026-10-01T10:00:00Z'),
              event: { title: 'Tournoi' },
            },
          ]
        : [
            {
              status: 'REFUSED',
              answeredAt: new Date('2026-10-02T10:00:00Z'),
              refusalComment: 'La salle est prise.',
              event: { title: 'Soirée' },
            },
          ]) as never);
    const body = JSON.parse(await (await GET()).text());

    expect(body.events.intraRequestsSent).toEqual([
      { status: 'PENDING', requestedAt: '2026-10-01T10:00:00.000Z', event: { title: 'Tournoi' } },
    ]);
    expect(body.events.intraRequestsAnswered).toEqual([
      {
        status: 'REFUSED',
        answeredAt: '2026-10-02T10:00:00.000Z',
        refusalComment: 'La salle est prise.',
        event: { title: 'Soirée' },
      },
    ]);
    expect(prisma.intraRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestedById: 'u1' } }),
    );
    expect(prisma.intraRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { answeredById: 'u1' } }),
    );
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
    expect(body.user).toMatchObject({ status: 'MEMBER', role: 'Membre' });
  });

  it('includes everything else the platform holds about the member: dates in charge of, dates cancelled, proposals refused', async () => {
    const body = JSON.parse(await (await GET()).text());

    expect(body.events.datesInChargeOf).toEqual([
      { title: 'Jeux', occurrenceStart: '2026-11-04T19:00:00.000Z' },
    ]);
    expect(body.events.cancelledDates).toEqual([
      {
        title: 'Jeux',
        occurrenceStart: '2026-11-11T19:00:00.000Z',
        cancelledAt: '2026-11-10T09:00:00.000Z',
      },
    ]);
    expect(body.events.refusedProposals).toEqual([
      {
        title: 'Soirée trop tardive',
        refusedAt: '2026-10-01T10:00:00.000Z',
        refusalComment: 'Pendant les examens.',
      },
    ]);
  });

  it('includes what was done to the account, without saying by whom (that is the data of another person)', async () => {
    vi.mocked(prisma.auditLog.findMany).mockImplementation((async (args: {
      where: Record<string, unknown>;
    }) =>
      args.where.targetType === 'User'
        ? [
            {
              action: 'member.approve',
              targetLabel: 'alice',
              createdAt: new Date('2026-09-02T08:00:00Z'),
            },
          ]
        : []) as never);
    const body = JSON.parse(await (await GET()).text());

    expect(body.auditLogAboutYou).toEqual([
      { action: 'member.approve', targetLabel: 'alice', createdAt: '2026-09-02T08:00:00.000Z' },
    ]);
    expect(Object.keys(body.auditLogAboutYou[0])).not.toContain('actorLogin');
  });

  it('filters every query on the member, never on a value that could be missing (Prisma drops an undefined filter and exports everybody)', async () => {
    await GET();

    const filters = [
      ...vi.mocked(prisma.auditLog.findMany).mock.calls.map(([args]) => args?.where),
      ...vi.mocked(prisma.event.findMany).mock.calls.map(([args]) => args?.where),
      ...vi.mocked(prisma.eventAssignee.findMany).mock.calls.map(([args]) => args?.where),
      ...vi.mocked(prisma.eventOccurrenceAssignee.findMany).mock.calls.map(([args]) => args?.where),
      ...vi.mocked(prisma.eventCancellation.findMany).mock.calls.map(([args]) => args?.where),
    ];
    expect(filters.length).toBeGreaterThanOrEqual(7);
    for (const where of filters) {
      expect(where).toBeDefined();
      for (const value of Object.values(where ?? {})) expect(value).not.toBeUndefined();
    }
  });

  it('exports nothing about anybody, rather than everybody, if the account has no login', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      login: '',
      status: 'MEMBER',
      role: null,
      calendarToken: null,
    } as never);
    const body = JSON.parse(await (await GET()).text());
    expect(body.events.refusedProposals).toEqual([]);
    const refusals = vi
      .mocked(prisma.event.findMany)
      .mock.calls.filter(([args]) => args?.where && 'refusedByLogin' in args.where);
    expect(refusals).toEqual([]);
  });
});

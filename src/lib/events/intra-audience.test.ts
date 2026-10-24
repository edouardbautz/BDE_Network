import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: mocks.findMany } } }));
vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));

const { staffAudience, STAFF_RIGHT } = await import('./intra-audience');
const { EVENTS_INTRA_PUBLISH } = await import('./access');

const person = (email: string, discord: string | null = null, slack: string | null = null) => ({
  email,
  discordUserId: discord,
  slackUserId: slack,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('who the messages for the staff are for', () => {
  it('names the right the way the rest of the platform does', () => {
    expect(STAFF_RIGHT).toBe(EVENTS_INTRA_PUBLISH);
  });

  it('is the members whose role LISTS the right to publish on the intra, never the owners, while there are some', async () => {
    mocks.findMany.mockResolvedValueOnce([
      person('sophie@example.org', '348291047563210241', 'U04ABCD1234'),
      person('marc@example.org', '348291047563210242'),
    ]);
    const audience = await staffAudience();

    expect(audience).toEqual({
      emails: ['sophie@example.org', 'marc@example.org'],
      discordIds: ['348291047563210241', '348291047563210242'],
      slackIds: ['U04ABCD1234'],
      fallsBackOnOwners: false,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    // only members, by the permissions their role lists: a role that holds everything (the Admin role) is not the staff
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { status: 'MEMBER', role: { permissions: { has: 'events.intra_publish' } } },
      select: { email: true, discordUserId: true, slackUserId: true },
    });
  });

  it('is the owners when nobody was given the right', async () => {
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([person('owner@example.org', '348291047563210243')]);
    const audience = await staffAudience();

    expect(audience).toMatchObject({
      emails: ['owner@example.org'],
      discordIds: ['348291047563210243'],
      fallsBackOnOwners: true,
    });
    expect(mocks.findMany).toHaveBeenLastCalledWith({
      where: { status: 'OWNER' },
      select: { email: true, discordUserId: true, slackUserId: true },
    });
  });

  it('writes to nobody twice (a shared mailbox, the same id given twice) and skips the people who gave no id', async () => {
    mocks.findMany.mockResolvedValueOnce([
      person('shared@example.org', '348291047563210241'),
      person('shared@example.org', '348291047563210241'),
      person('quiet@example.org'),
    ]);
    const audience = await staffAudience();
    expect(audience.emails).toEqual(['shared@example.org', 'quiet@example.org']);
    expect(audience.discordIds).toEqual(['348291047563210241']);
    expect(audience.slackIds).toEqual([]);
  });

  it('is nobody when there is no owner either (the messages still go to the room)', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await staffAudience()).toEqual({
      emails: [],
      discordIds: [],
      slackIds: [],
      fallsBackOnOwners: true,
    });
  });
});

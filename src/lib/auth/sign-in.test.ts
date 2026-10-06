import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'next-auth';

/**
 * The sign-in callback: who is let in, what account they get, and who is told about a new
 * request. The notification is the only part that reaches outside the database, so it is the
 * part these tests watch closely: once per new request, never for an owner, never on a return visit.
 */

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));

vi.mock('next/server', () => ({
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback);
  }),
}));
vi.mock('@/lib/members/notifications', () => ({ notifyMemberPending: vi.fn() }));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    auth: { owners: ['boss'], allowedCampuses: ['Paris'] },
    modules: { enabled: [] },
  })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    role: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import('@/lib/prisma');
const { notifyMemberPending } = await import('@/lib/members/notifications');
const { signInCallback } = await import('./callbacks');

const profile = (login: string, overrides: Partial<User> = {}): User =>
  ({
    login,
    name: `Name of ${login}`,
    email: `${login}@example.org`,
    campus: 'Paris',
    image: null,
    ...overrides,
  }) as User;

async function runAfter(): Promise<void> {
  for (const callback of afterCallbacks.splice(0)) await callback();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockImplementation((async ({
    data,
  }: {
    data: { login: string; status: string };
  }) => ({ id: `id_${data.login}`, ...data })) as never);
});

describe('signInCallback — who gets in', () => {
  it.each([
    ['login', { login: undefined }],
    ['campus', { campus: undefined }],
    ['email', { email: undefined }],
  ])('refuses an incomplete 42 profile (no %s) without touching the database', async (_f, gap) => {
    const result = await signInCallback({ user: profile('alice', gap as Partial<User>) });

    expect(result).toBe('/auth-error?reason=missing-profile');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it('refuses a campus the BDE does not take, and tells nobody', async () => {
    const result = await signInCallback({ user: profile('alice', { campus: 'Lyon' }) });

    expect(result).toBe('/auth-error?reason=campus-not-allowed&campus=Lyon');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe('signInCallback — a new account', () => {
  it('starts as PENDING and tells whoever can approve it, after the sign-in', async () => {
    await expect(signInCallback({ user: profile('alice') })).resolves.toBe(true);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ login: 'alice', status: 'PENDING' }),
    });
    expect(notifyMemberPending).not.toHaveBeenCalled(); // not before the response
    await runAfter();
    expect(notifyMemberPending).toHaveBeenCalledExactlyOnceWith('id_alice');
  });

  it('is an OWNER when the config lists the login, and nobody is asked to approve them', async () => {
    await expect(signInCallback({ user: profile('Boss') })).resolves.toBe(true);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'OWNER' }),
    });
    await runAfter();
    expect(notifyMemberPending).not.toHaveBeenCalled();
  });
});

describe('signInCallback — someone who comes back', () => {
  it('updates the profile and never notifies again, even while still pending', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      login: 'alice',
      fullName: 'Old Name',
      status: 'PENDING',
      roleId: null,
    } as never);

    await expect(signInCallback({ user: profile('alice') })).resolves.toBe(true);

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { login: 'alice' } }),
    );
    await runAfter();
    expect(notifyMemberPending).not.toHaveBeenCalled();
  });
});

describe('signInCallback — two first sign-ins at the same moment', () => {
  const duplicate = Object.assign(new Error('Unique constraint failed on login'), {
    code: 'P2002',
  });

  it('lets the second one through as a return visit, without notifying twice', async () => {
    // Our look finds nothing, then the other request creates the account before our insert.
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'id_alice',
        login: 'alice',
        fullName: 'Name of alice',
        status: 'PENDING',
        roleId: null,
      } as never);
    vi.mocked(prisma.user.create).mockRejectedValue(duplicate);

    await expect(signInCallback({ user: profile('alice') })).resolves.toBe(true);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { login: 'alice' } }),
    );
    await runAfter();
    expect(notifyMemberPending).not.toHaveBeenCalled(); // the request that created it notifies
  });

  it('still fails on any other database error', async () => {
    vi.mocked(prisma.user.create).mockRejectedValue(new Error('connection lost'));
    // Even if an account with this login exists by now, a failure that is not a duplicate is not a race.
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'u1',
        login: 'alice',
        fullName: 'A',
        status: 'PENDING',
        roleId: null,
      } as never);

    await expect(signInCallback({ user: profile('alice') })).rejects.toThrow('connection lost');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('fails if the account that "already exists" cannot be found (not a login race)', async () => {
    vi.mocked(prisma.user.create).mockRejectedValue(duplicate);

    await expect(signInCallback({ user: profile('alice') })).rejects.toThrow('Unique constraint');
  });
});

describe('signInCallback — an e-mail address another account already has', () => {
  it('lets a new account in: the address is not what identifies anyone', async () => {
    // The unique index on the address is gone (migration user_email_not_unique): the insert succeeds.
    await expect(
      signInCallback({ user: profile('newcomer', { email: 'shared@example.org' }) }),
    ).resolves.toBe(true);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ login: 'newcomer', email: 'shared@example.org' }),
    });
  });

  it('keeps the account that signs in with an address another one holds', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      login: 'alice',
      fullName: 'Alice',
      status: 'MEMBER',
      roleId: 'role-member',
    } as never);

    await expect(
      signInCallback({ user: profile('alice', { email: 'taken-by-bob@example.org' }) }),
    ).resolves.toBe(true);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { login: 'alice' },
        data: expect.objectContaining({ email: 'taken-by-bob@example.org' }),
      }),
    );
  });
});

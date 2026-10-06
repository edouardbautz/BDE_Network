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

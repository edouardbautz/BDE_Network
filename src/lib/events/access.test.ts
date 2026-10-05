import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { modulePermission: { findMany: vi.fn() } } }));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { prisma } = await import('@/lib/prisma');
const { canManageEvents, canViewEvents, getEventsAccess, requireEventsManager } =
  await import('./access');

function setup(options: { enabled: boolean; role?: Role | null; granted?: string[] }) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: options.enabled ? ['events'] : [] },
  } as ReturnType<typeof getConfig>);

  vi.mocked(getEffectiveSession).mockResolvedValue(
    options.role
      ? ({
          user: { id: 'u1', login: 'someone', role: options.role },
          isImpersonating: false,
          realRole: options.role,
        } as Awaited<ReturnType<typeof getEffectiveSession>>)
      : null,
  );

  vi.mocked(prisma.modulePermission.findMany).mockResolvedValue(
    (options.granted ?? []).map((module) => ({ module })) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pure permission helpers', () => {
  it('lets every approved role view events but not PENDING', () => {
    expect(canViewEvents('MEMBER')).toBe(true);
    expect(canViewEvents('ADMIN')).toBe(true);
    expect(canViewEvents('OWNER')).toBe(true);
    expect(canViewEvents('PENDING')).toBe(false);
  });

  it('requires the events permission to manage, except for the OWNER', () => {
    expect(canManageEvents('MEMBER', [])).toBe(false);
    expect(canManageEvents('ADMIN', ['finance'])).toBe(false);
    expect(canManageEvents('MEMBER', ['events'])).toBe(true);
    expect(canManageEvents('ADMIN', ['events'])).toBe(true);
    expect(canManageEvents('OWNER', [])).toBe(true);
  });

  it('never lets a PENDING account manage, even with a stale permission row', () => {
    expect(canManageEvents('PENDING', ['events'])).toBe(false);
  });
});

describe('getEventsAccess', () => {
  it('returns null when the module is disabled, whoever asks', async () => {
    setup({ enabled: false, role: 'OWNER' });
    await expect(getEventsAccess()).resolves.toBeNull();
    expect(getEffectiveSession).not.toHaveBeenCalled();
  });

  it('returns null without a session', async () => {
    setup({ enabled: true, role: null });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('returns null for a PENDING account', async () => {
    setup({ enabled: true, role: 'PENDING', granted: ['events'] });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('gives a plain member read-only access', async () => {
    setup({ enabled: true, role: 'MEMBER' });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: false });
  });

  it('gives a member with the events permission management access', async () => {
    setup({ enabled: true, role: 'MEMBER', granted: ['events'] });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: true });
  });

  it('does not treat another module permission as events access', async () => {
    setup({ enabled: true, role: 'ADMIN', granted: ['finance'] });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: false });
  });
});

describe('requireEventsManager', () => {
  it.each<[string, Parameters<typeof setup>[0]]>([
    ['module disabled', { enabled: false, role: 'OWNER' }],
    ['no session', { enabled: true, role: null }],
    ['PENDING', { enabled: true, role: 'PENDING', granted: ['events'] }],
    ['member without permission', { enabled: true, role: 'MEMBER' }],
    ['admin without permission', { enabled: true, role: 'ADMIN' }],
  ])('throws Forbidden: %s', async (_label, options) => {
    setup(options);
    await expect(requireEventsManager()).rejects.toThrow('Forbidden');
  });

  it('allows a member with the permission and the owner', async () => {
    setup({ enabled: true, role: 'MEMBER', granted: ['events'] });
    await expect(requireEventsManager()).resolves.toMatchObject({ canManage: true });
    setup({ enabled: true, role: 'OWNER' });
    await expect(requireEventsManager()).resolves.toMatchObject({ canManage: true });
  });
});

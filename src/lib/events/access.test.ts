import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const {
  canManageEvents,
  canManageSharedCalendar,
  canViewEvents,
  getEventsAccess,
  requireEventsManager,
  requireSharedCalendarManager,
} = await import('./access');

type Who = AccountKind | { permissions: string[] } | null;

function setup(options: { enabled: boolean; who: Who }) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: options.enabled ? ['events'] : [] },
  } as ReturnType<typeof getConfig>);

  const { who } = options;
  vi.mocked(getEffectiveSession).mockResolvedValue(
    who === null
      ? null
      : typeof who === 'string'
        ? effectiveFor(who)
        : effective(memberWith(who.permissions)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pure permission helpers', () => {
  const holder = (permissions: string[], status: 'MEMBER' | 'PENDING' = 'MEMBER') => ({
    status,
    permissions,
  });

  it('views events with events.view, not without', () => {
    expect(canViewEvents(holder(['events.view']))).toBe(true);
    expect(canViewEvents(holder([]))).toBe(false);
    expect(canViewEvents(holder(['events.manage']))).toBe(false);
  });

  it('manages events with events.manage only', () => {
    expect(canManageEvents(holder(['events.manage']))).toBe(true);
    expect(canManageEvents(holder(['events.view']))).toBe(false);
    expect(canManageEvents(holder(['finance.manage']))).toBe(false);
  });

  it('manages the shared calendar with its own permission, not with events.manage', () => {
    expect(canManageSharedCalendar(holder(['events.shared_calendar']))).toBe(true);
    expect(canManageSharedCalendar(holder(['events.manage', 'events.view']))).toBe(false);
  });

  it('never lets a PENDING account do any of it, even with permissions attached by mistake', () => {
    const pending = holder(['events.view', 'events.manage', 'events.shared_calendar'], 'PENDING');
    expect(canViewEvents(pending)).toBe(false);
    expect(canManageEvents(pending)).toBe(false);
    expect(canManageSharedCalendar(pending)).toBe(false);
  });
});

describe('getEventsAccess', () => {
  it('returns null when the module is disabled, whoever asks', async () => {
    setup({ enabled: false, who: 'OWNER' });
    await expect(getEventsAccess()).resolves.toBeNull();
    expect(getEffectiveSession).not.toHaveBeenCalled();
  });

  it('returns null without a session', async () => {
    setup({ enabled: true, who: null });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('returns null for a PENDING account', async () => {
    setup({ enabled: true, who: 'PENDING' });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('returns null for a member whose role does not include viewing events', async () => {
    setup({ enabled: true, who: { permissions: ['members.manage'] } });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('gives the default member read-only access', async () => {
    setup({ enabled: true, who: 'MEMBER' });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: false });
  });

  it('gives a member whose role manages events management access', async () => {
    setup({ enabled: true, who: { permissions: ['events.view', 'events.manage'] } });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: true });
  });

  it('does not treat another module permission as events access', async () => {
    setup({ enabled: true, who: { permissions: ['events.view', 'finance.manage'] } });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: false });
  });

  it('gives owners and admins (all permissions) management access', async () => {
    setup({ enabled: true, who: 'OWNER' });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: true });
    setup({ enabled: true, who: 'ADMIN' });
    await expect(getEventsAccess()).resolves.toMatchObject({ canManage: true });
  });
});

describe('requireEventsManager', () => {
  it.each<[string, Parameters<typeof setup>[0]]>([
    ['module disabled', { enabled: false, who: 'OWNER' }],
    ['no session', { enabled: true, who: null }],
    ['PENDING', { enabled: true, who: 'PENDING' }],
    ['default member', { enabled: true, who: 'MEMBER' }],
    ['role that only views', { enabled: true, who: { permissions: ['events.view'] } }],
    [
      'role that only manages the shared calendar',
      { enabled: true, who: { permissions: ['events.shared_calendar'] } },
    ],
  ])('throws Forbidden: %s', async (_label, options) => {
    setup(options);
    await expect(requireEventsManager()).rejects.toThrow('Forbidden');
  });

  it('allows a role that manages events, and the owner', async () => {
    setup({ enabled: true, who: { permissions: ['events.view', 'events.manage'] } });
    await expect(requireEventsManager()).resolves.toMatchObject({ canManage: true });
    setup({ enabled: true, who: 'OWNER' });
    await expect(requireEventsManager()).resolves.toMatchObject({ canManage: true });
  });
});

describe('requireSharedCalendarManager', () => {
  it.each<[string, Parameters<typeof setup>[0]]>([
    ['module disabled', { enabled: false, who: 'OWNER' }],
    ['no session', { enabled: true, who: null }],
    ['PENDING', { enabled: true, who: 'PENDING' }],
    ['default member', { enabled: true, who: 'MEMBER' }],
    [
      'a role that manages events but not the shared calendar',
      { enabled: true, who: { permissions: ['events.view', 'events.manage'] } },
    ],
  ])('throws Forbidden: %s', async (_label, options) => {
    setup(options);
    await expect(requireSharedCalendarManager()).rejects.toThrow('Forbidden');
  });

  it('allows a role with the shared-calendar permission, even without events.manage', async () => {
    setup({ enabled: true, who: { permissions: ['events.view', 'events.shared_calendar'] } });
    await expect(requireSharedCalendarManager()).resolves.toMatchObject({ canManage: false });
  });
});

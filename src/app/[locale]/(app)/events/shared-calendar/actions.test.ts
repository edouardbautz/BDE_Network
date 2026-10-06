import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

/**
 * The BDE-wide calendar link is managed with the events.shared_calendar permission only. Each action
 * is its own entry point, so each re-checks. Runs the real access rules
 * against mocked session/config/database.
 */

const { RedirectSignal } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: { pathname: string; query: { status: string } } }) => {
    throw new RedirectSignal(`${options.href.pathname}?status=${options.href.query.status}`);
  }),
}));
vi.mock('@/lib/events/export', () => ({
  getBdeFeedToken: vi.fn(),
  enableBdeFeed: vi.fn(),
  regenerateBdeFeed: vi.fn(),
  disableBdeFeed: vi.fn(),
}));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { logAuditEvent } = await import('@/lib/audit-log');
const feed = await import('@/lib/events/export');
const { disableSharedCalendar, enableSharedCalendar, regenerateSharedCalendar } =
  await import('./actions');

const SECRET = 'S'.repeat(43);

type Who = AccountKind | { permissions: string[] } | null;

interface Scenario {
  enabled?: boolean;
  who: Who;
}

function setup({ enabled = true, who }: Scenario) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: enabled ? ['events'] : [] },
  } as unknown as ReturnType<typeof getConfig>);
  vi.mocked(getEffectiveSession).mockResolvedValue(
    who === null
      ? null
      : typeof who === 'string'
        ? effectiveFor(who, 'real-actor')
        : effective(memberWith(who.permissions, 'real-actor')),
  );
}

const FORBIDDEN: [string, Scenario][] = [
  ['no session', { who: null }],
  ['a PENDING account', { who: 'PENDING' }],
  ['the default member', { who: 'MEMBER' }],
  [
    'a member whose role manages events but not the shared calendar',
    { who: { permissions: ['events.view', 'events.manage'] } },
  ],
  ['an admin when the module is disabled', { who: 'ADMIN', enabled: false }],
  ['the OWNER when the module is disabled', { who: 'OWNER', enabled: false }],
];

function expectNothingHappened() {
  expect(feed.enableBdeFeed).not.toHaveBeenCalled();
  expect(feed.regenerateBdeFeed).not.toHaveBeenCalled();
  expect(feed.disableBdeFeed).not.toHaveBeenCalled();
  expect(logAuditEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(feed.enableBdeFeed).mockResolvedValue(SECRET);
  vi.mocked(feed.regenerateBdeFeed).mockResolvedValue(SECRET);
});

describe('access control', () => {
  describe.each(FORBIDDEN)('%s', (_label, scenario) => {
    beforeEach(() => setup(scenario));

    it('cannot enable the link', async () => {
      await expect(enableSharedCalendar()).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot regenerate the link', async () => {
      await expect(regenerateSharedCalendar()).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });

    it('cannot disable the link', async () => {
      await expect(disableSharedCalendar()).rejects.toThrow('Forbidden');
      expectNothingHappened();
    });
  });
});

describe.each<[string, Who]>([
  ['an ADMIN (all permissions)', 'ADMIN'],
  ['the OWNER', 'OWNER'],
  [
    'a member whose role has only the shared-calendar permission',
    { permissions: ['events.shared_calendar'] },
  ],
])('as %s', (_label, who) => {
  beforeEach(() => setup({ who }));

  it('enables the link and audits it', async () => {
    vi.mocked(feed.getBdeFeedToken).mockResolvedValue(null);
    await expect(enableSharedCalendar()).rejects.toThrow(
      new RedirectSignal('/events/shared-calendar?status=enabled'),
    );
    expect(feed.enableBdeFeed).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorLogin: 'real-actor',
        action: 'calendar_feed.enable',
        targetType: 'CalendarFeed',
      }),
    );
  });

  it('does not touch or log anything when enabling an already active link', async () => {
    vi.mocked(feed.getBdeFeedToken).mockResolvedValue(SECRET);
    await expect(enableSharedCalendar()).rejects.toThrow(RedirectSignal);
    expect(feed.enableBdeFeed).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('regenerates the link and audits it', async () => {
    await expect(regenerateSharedCalendar()).rejects.toThrow(
      new RedirectSignal('/events/shared-calendar?status=regenerated'),
    );
    expect(feed.regenerateBdeFeed).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calendar_feed.regenerate' }),
    );
  });

  it('records why when regenerating after a member was removed', async () => {
    await expect(regenerateSharedCalendar('departed-user')).rejects.toThrow(RedirectSignal);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'member_removed', member: 'departed-user' }),
      }),
    );
  });

  it('drops a removed-member value that is not a plain login instead of storing it', async () => {
    await expect(regenerateSharedCalendar('<script>alert(1)</script>')).rejects.toThrow(
      RedirectSignal,
    );
    const entry = vi.mocked(logAuditEvent).mock.calls[0]?.[0];
    expect(entry?.metadata).toEqual({});
  });

  it('disables the link and audits it', async () => {
    vi.mocked(feed.getBdeFeedToken).mockResolvedValue(SECRET);
    await expect(disableSharedCalendar()).rejects.toThrow(
      new RedirectSignal('/events/shared-calendar?status=disabled'),
    );
    expect(feed.disableBdeFeed).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calendar_feed.disable' }),
    );
  });

  it('does not log disabling a link that is already off', async () => {
    vi.mocked(feed.getBdeFeedToken).mockResolvedValue(null);
    await expect(disableSharedCalendar()).rejects.toThrow(RedirectSignal);
    expect(feed.disableBdeFeed).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('never writes the token to the audit log or to the console', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    vi.mocked(feed.getBdeFeedToken).mockResolvedValueOnce(null).mockResolvedValue(SECRET);

    await expect(enableSharedCalendar()).rejects.toThrow(RedirectSignal);
    await expect(regenerateSharedCalendar('departed-user')).rejects.toThrow(RedirectSignal);
    await expect(disableSharedCalendar()).rejects.toThrow(RedirectSignal);

    expect(logAuditEvent).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(vi.mocked(logAuditEvent).mock.calls)).not.toContain(SECRET);
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    }
  });
});

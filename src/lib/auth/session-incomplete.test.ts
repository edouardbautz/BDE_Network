import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor } from '@/test/session-fixtures';

/**
 * An account that has not given an id the BDE needs holds NOTHING until it does: its session is the one of an account waiting for approval, whatever
 * it really is (an owner included), so every page, action and check refuses without a line of code to remember in each. `realStatus` still says
 * who is there, and `missingIds` what to ask.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    modules: { enabled: ['events'] },
    events: { intraPublication: true },
  })),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { role: { findUnique: vi.fn() } } }));
vi.mock('@/lib/dev-impersonation', () => ({
  isDevImpersonationEnabled: vi.fn(() => false),
  getImpersonation: vi.fn(),
}));

const { auth } = await import('@/lib/auth');
const { getEffectiveSession } = await import('./session');
const { can, canManageSettings, canViewAuditLog, isApproved } = await import('@/lib/permissions');

const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

const withIds = (session: Session, ids: { discord?: string | null; slack?: string | null }) => {
  session.user.discordUserId = ids.discord ?? null;
  session.user.slackUserId = ids.slack ?? null;
  return session;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('a platform is configured and an id is missing', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.com/api/webhooks/1/a');
  });

  it.each(['MEMBER', 'ADMIN', 'OWNER'] as const)(
    'holds nothing, whoever %s is: the session of an account waiting for approval',
    async (kind) => {
      mockAuth.mockResolvedValue(withIds(sessionFor(kind), {}));
      const result = await getEffectiveSession();

      expect(result?.missingIds).toEqual(['discord']);
      expect(result?.realStatus).toBe(sessionFor(kind).user.status);
      expect(result?.user.status).toBe('PENDING');
      expect(result?.user.permissions).toEqual([]);
      expect(result?.user.holdsAll).toBe(false);
      expect(result?.user.roleId).toBeNull();
      // and so every check refuses
      expect(isApproved(result!.user.status)).toBe(false);
      expect(can(result!.user, 'events.view')).toBe(false);
      expect(canManageSettings(result!.user)).toBe(false);
      expect(canViewAuditLog(result!.user)).toBe(false);
      // who it really is, and what it still has to give, are kept
      expect(result?.user.login).toBe(sessionFor(kind).user.login);
    },
  );

  it.each(['MEMBER', 'ADMIN', 'PENDING'] as const)(
    'never marks %s as the owner who keeps the settings',
    async (kind) => {
      mockAuth.mockResolvedValue(withIds(sessionFor(kind), {}));
      expect((await getEffectiveSession())?.ownerEscape).toBe(false);
    },
  );

  it('marks the real owner only, and still holds nothing', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('OWNER'), {}));
    const result = await getEffectiveSession();
    expect(result?.ownerEscape).toBe(true);
    expect(result?.user.status).toBe('PENDING');
    expect(canManageSettings(result!.user)).toBe(false);
  });

  it('marks nobody once the ids are given', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('OWNER'), { discord: '348291047563210241' }));
    expect((await getEffectiveSession())?.ownerEscape).toBe(false);
  });

  it('holds what it held once the id is given, and nothing is missing', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('OWNER'), { discord: '348291047563210241' }));
    const result = await getEffectiveSession();
    expect(result?.missingIds).toEqual([]);
    expect(result?.user.status).toBe('OWNER');
    expect(canManageSettings(result!.user)).toBe(true);
  });

  it('asks only for the platform that is configured', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('MEMBER'), { slack: 'U04ABCD1234' }));
    expect((await getEffectiveSession())?.missingIds).toEqual(['discord']);
  });

  it('asks a pending account too, which keeps being pending', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('PENDING'), {}));
    const result = await getEffectiveSession();
    expect(result?.missingIds).toEqual(['discord']);
    expect(result?.realStatus).toBe('PENDING');
  });
});

describe('no platform is configured', () => {
  it('asks nothing of anybody', async () => {
    mockAuth.mockResolvedValue(withIds(sessionFor('OWNER'), {}));
    const result = await getEffectiveSession();
    expect(result?.missingIds).toEqual([]);
    expect(result?.user.status).toBe('OWNER');
  });
});

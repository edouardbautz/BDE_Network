import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor } from '@/test/session-fixtures';

/**
 * Every render of a page resolves the session several times (layout, page, access checks), and
 * each `auth()` replays the jwt and session callbacks: three SQL queries. The session is
 * therefore resolved through `React.cache`, which memoizes per request. Outside a server render
 * `cache` is a plain call, so this test stands one in that memoizes within a "request" that the
 * test starts and ends by hand.
 */

const { requests } = vi.hoisted(() => ({ requests: { current: new Map<unknown, unknown>() } }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      if (!requests.current.has(fn)) requests.current.set(fn, fn(...args));
      return requests.current.get(fn);
    }) as T,
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ modules: { enabled: ['events'] } })) }));
vi.mock('@/lib/prisma', () => ({ prisma: { role: { findUnique: vi.fn() } } }));
vi.mock('@/lib/dev-impersonation', () => ({
  isDevImpersonationEnabled: vi.fn(() => false),
  getImpersonation: vi.fn(),
}));

const { auth } = await import('@/lib/auth');
const { getEffectiveSession } = await import('./session');
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

beforeEach(() => {
  vi.clearAllMocks();
  requests.current = new Map();
});

describe('getEffectiveSession — once per request', () => {
  it('replays the session callbacks once however many times a render asks', async () => {
    mockAuth.mockResolvedValue(sessionFor('ADMIN'));

    const [layout, page, access] = await Promise.all([
      getEffectiveSession(),
      getEffectiveSession(),
      getEffectiveSession(),
    ]);
    await getEffectiveSession();

    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(page).toBe(layout);
    expect(access).toBe(layout);
  });

  it('shares nothing between two requests: a removal or a role change shows at once', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('ADMIN'));
    await expect(getEffectiveSession()).resolves.toMatchObject({ user: { roleName: 'Admin' } });

    requests.current = new Map(); // the next request
    mockAuth.mockResolvedValueOnce(null); // the account was removed in between
    await expect(getEffectiveSession()).resolves.toBeNull();

    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it('caches a refusal too: a removed account stays signed out for the rest of the render', async () => {
    mockAuth.mockResolvedValue(null);

    await getEffectiveSession();
    await getEffectiveSession();

    expect(mockAuth).toHaveBeenCalledTimes(1);
  });
});

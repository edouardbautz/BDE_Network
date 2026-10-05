import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Both conditions (NODE_ENV !== production, ENABLE_DEV_IMPERSONATION=true)
 * are mandatory — proves the full 2x2 matrix, especially that production
 * stays inert even if the opt-in flag was accidentally left on.
 */

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const { cookies } = await import('next/headers');
const {
  DEV_IMPERSONATION_COOKIE,
  isDevImpersonationEnabled,
  isImpersonatableRole,
  getImpersonationCookieRole,
} = await import('./dev-impersonation');

function fakeCookieStore(value?: string) {
  return {
    get: (name: string) =>
      name === DEV_IMPERSONATION_COOKIE && value !== undefined ? { name, value } : undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevImpersonationEnabled', () => {
  it('is enabled only when both conditions hold', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    expect(isDevImpersonationEnabled()).toBe(true);
  });

  it('is disabled outside production when the flag is missing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', '');
    expect(isDevImpersonationEnabled()).toBe(false);
  });

  it('is disabled in production even when the flag is set to true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    expect(isDevImpersonationEnabled()).toBe(false);
  });

  it('is disabled when both conditions are missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', '');
    expect(isDevImpersonationEnabled()).toBe(false);
  });
});

describe('isImpersonatableRole', () => {
  it('accepts PENDING, MEMBER, ADMIN', () => {
    expect(isImpersonatableRole('PENDING')).toBe(true);
    expect(isImpersonatableRole('MEMBER')).toBe(true);
    expect(isImpersonatableRole('ADMIN')).toBe(true);
  });

  it('rejects OWNER — you can only simulate a role below your real one', () => {
    expect(isImpersonatableRole('OWNER')).toBe(false);
  });

  it('rejects garbage and empty values', () => {
    expect(isImpersonatableRole('SUPERADMIN')).toBe(false);
    expect(isImpersonatableRole(undefined)).toBe(false);
    expect(isImpersonatableRole(null)).toBe(false);
  });
});

describe('getImpersonationCookieRole', () => {
  it('ignores the cookie entirely in production, regardless of its content', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('MEMBER'));

    await expect(getImpersonationCookieRole()).resolves.toBeNull();
    expect(cookies).not.toHaveBeenCalled();
  });

  it('returns the simulated role when enabled and the cookie holds a valid role', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('MEMBER'));

    await expect(getImpersonationCookieRole()).resolves.toBe('MEMBER');
  });

  it('returns null for a tampered/garbage cookie value', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('SUPERADMIN'));

    await expect(getImpersonationCookieRole()).resolves.toBeNull();
  });

  it('returns null when no cookie is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore(undefined));

    await expect(getImpersonationCookieRole()).resolves.toBeNull();
  });
});

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
  getImpersonation,
  parseImpersonation,
  serializeImpersonation,
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

describe('parseImpersonation / serializeImpersonation', () => {
  it('accepts PENDING and a role id', () => {
    expect(parseImpersonation('PENDING')).toEqual({ kind: 'pending' });
    expect(parseImpersonation('role:role-admin')).toEqual({ kind: 'role', roleId: 'role-admin' });
    expect(parseImpersonation('role:ckx9a8b7c0000')).toEqual({
      kind: 'role',
      roleId: 'ckx9a8b7c0000',
    });
  });

  it('rejects OWNER — you can only simulate something below your real status', () => {
    expect(parseImpersonation('OWNER')).toBeNull();
  });

  it('rejects garbage, empty values and malformed role ids', () => {
    for (const value of [
      'SUPERADMIN',
      'MEMBER',
      'role:',
      'role:a b',
      'role:../x',
      'role:' + 'a'.repeat(65),
      '',
      undefined,
      null,
    ]) {
      expect(parseImpersonation(value as string)).toBeNull();
    }
  });

  it('round-trips', () => {
    for (const value of ['PENDING', 'role:role-member']) {
      const parsed = parseImpersonation(value);
      expect(parsed && serializeImpersonation(parsed)).toBe(value);
    }
  });
});

describe('getImpersonation', () => {
  it('ignores the cookie entirely in production, regardless of its content', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('role:role-member'));

    await expect(getImpersonation()).resolves.toBeNull();
    expect(cookies).not.toHaveBeenCalled();
  });

  it('returns the simulation when enabled and the cookie holds a valid choice', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('role:role-member'));

    await expect(getImpersonation()).resolves.toEqual({ kind: 'role', roleId: 'role-member' });
  });

  it('returns null for a tampered/garbage cookie value', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore('SUPERADMIN'));

    await expect(getImpersonation()).resolves.toBeNull();
  });

  it('returns null when no cookie is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_IMPERSONATION', 'true');
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore(undefined));

    await expect(getImpersonation()).resolves.toBeNull();
  });
});

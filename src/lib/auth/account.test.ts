import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { role: { findFirst: mocks.findFirst } } }));

const { accountAfterLogin } = await import('./account');

/**
 * The status an account has after signing in, given whether the list of owners names it right now. The list is the only source
 * of OWNER: granted when the login is listed, taken away when it is not. Every test of the sign-in replaces this function by a
 * stand-in; found by the mutation testing of the quality campaign, which changed each of its lines and no test noticed.
 */

beforeEach(() => vi.clearAllMocks());

describe('accountAfterLogin', () => {
  it('makes an owner of anybody the list names, with no role, whatever they were', async () => {
    for (const status of ['OWNER', 'MEMBER', 'PENDING'] as const) {
      const result = await accountAfterLogin({ status, roleId: 'role-x' }, true);
      expect(result, status).toEqual({ status: 'OWNER', roleId: null });
    }
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('leaves a member and a waiting account as they were when the list does not name them', async () => {
    expect(await accountAfterLogin({ status: 'MEMBER', roleId: 'role-x' }, false)).toEqual({
      status: 'MEMBER',
      roleId: 'role-x',
    });
    expect(await accountAfterLogin({ status: 'PENDING', roleId: null }, false)).toEqual({
      status: 'PENDING',
      roleId: null,
    });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('demotes an owner the list no longer names to a member with the default role', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'role-default' });
    expect(await accountAfterLogin({ status: 'OWNER', roleId: null }, false)).toEqual({
      status: 'MEMBER',
      roleId: 'role-default',
    });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
      select: { id: true },
    });
  });

  it('sends a former owner back to waiting when there is no default role, rather than holding anything by accident', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await accountAfterLogin({ status: 'OWNER', roleId: null }, false)).toEqual({
      status: 'PENDING',
      roleId: null,
    });
  });
});

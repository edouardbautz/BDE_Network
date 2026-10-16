import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The arguments of a server action come from the browser, and a crafted request can send anything: what is not a plain,
 * short string is refused before it can reach a query or the transaction (the rules of the roles themselves are in
 * lib/roles/escalation.test.ts, on the real actions).
 */

const execution = vi.hoisted(() => ({ execute: vi.fn(), executeToResult: vi.fn() }));
vi.mock('@/lib/roles/execute', () => execution);
vi.mock('@/lib/roles/service', () => ({
  approveMember: vi.fn(),
  rejectMember: vi.fn(),
  removeMember: vi.fn(),
  setMemberRole: vi.fn(),
}));
vi.mock('@/lib/members/notifications', () => ({
  notifyMemberApproved: vi.fn(),
  notifyMemberRemoved: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));

const { approveMember, rejectMember, removeMember } = await import('./actions');

beforeEach(() => vi.clearAllMocks());

const NOT_IDS: [string, unknown][] = [
  ['an empty string', ''],
  ['an id that is too long', 'x'.repeat(65)],
  ['a number', 12],
  ['an object, as in a query that could widen', { not: 'x' }],
  ['an array', ['a', 'b']],
  ['null', null],
  ['undefined, which a query would drop', undefined],
];

describe('a crafted id', () => {
  it.each(NOT_IDS)('is refused for the member, %s: nothing is executed', async (_name, value) => {
    expect(await approveMember(value as string, 'role-member')).toEqual({
      ok: false,
      error: 'targetNotFound',
    });
    expect(await rejectMember(value as string)).toEqual({ ok: false, error: 'targetNotFound' });
    expect(await removeMember(value as string)).toEqual({ ok: false, error: 'targetNotFound' });
    expect(execution.execute).not.toHaveBeenCalled();
    expect(execution.executeToResult).not.toHaveBeenCalled();
  });

  it.each(NOT_IDS)('is refused for the role, %s: nothing is executed', async (_name, value) => {
    expect(await approveMember('user-1', value as string)).toEqual({
      ok: false,
      error: 'roleNotFound',
    });
    expect(execution.execute).not.toHaveBeenCalled();
    expect(execution.executeToResult).not.toHaveBeenCalled();
  });

  it('is still checked against the member first: a crafted member id is reported before the role', async () => {
    expect(await approveMember('', '')).toEqual({ ok: false, error: 'targetNotFound' });
  });

  it('lets an id of the right shape through to the transaction, which decides', async () => {
    execution.executeToResult.mockResolvedValue({ ok: false, error: 'targetNotFound' });
    await rejectMember('a'.repeat(64));
    expect(execution.executeToResult).toHaveBeenCalledTimes(1);
  });
});

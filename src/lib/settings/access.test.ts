import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Who may open and change the settings: an OWNER, nobody else (an admin holding every permission included). */

const mocks = vi.hoisted(() => ({ session: vi.fn(), runtime: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('./runtime', () => ({ getRuntimeSettings: mocks.runtime }));

const { getSettingsManager, getSettingsOwner, isSettingsEditable, requireSettingsManager } =
  await import('./access');

const account = (status: string, holdsAll = false, ownerEscape = false) => ({
  user: { id: `u-${status}`, login: status.toLowerCase(), status, holdsAll, permissions: [] },
  ownerEscape,
});

/** What the session of an account that still has an id to give looks like: it holds nothing (a waiting account's), `ownerEscape` only for a real owner. */
const lockedByIds = (real: 'OWNER' | 'MEMBER', holdsAll = false) =>
  account('PENDING', holdsAll, real === 'OWNER');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSettingsManager', () => {
  it('gives the session of an owner', async () => {
    const owner = account('OWNER', true);
    mocks.session.mockResolvedValue(owner);
    expect(await getSettingsManager()).toBe(owner);
  });

  it.each([
    ['a member', account('MEMBER')],
    ['an admin who holds every permission', account('MEMBER', true)],
    ['somebody waiting for approval', account('PENDING')],
    ['nobody signed in', null],
  ])('gives nothing for %s', async (_who, session) => {
    mocks.session.mockResolvedValue(session);
    expect(await getSettingsManager()).toBeNull();
  });
});

describe('requireSettingsManager', () => {
  it('gives the owner', async () => {
    const owner = account('OWNER', true);
    mocks.session.mockResolvedValue(owner);
    expect(await requireSettingsManager()).toBe(owner);
  });

  it.each([
    ['a member', account('MEMBER')],
    ['an admin who holds every permission', account('MEMBER', true)],
    ['somebody waiting for approval', account('PENDING')],
    ['nobody signed in', null],
  ])('throws for %s', async (_who, session) => {
    mocks.session.mockResolvedValue(session);
    await expect(requireSettingsManager()).rejects.toThrow('Forbidden');
  });
});

describe('isSettingsEditable', () => {
  it('is true once the settings are loaded from the database, false while they are in the files', () => {
    mocks.runtime.mockReturnValue({});
    expect(isSettingsEditable()).toBe(true);
    mocks.runtime.mockReturnValue(undefined);
    expect(isSettingsEditable()).toBe(false);
  });
});

describe('an account that still has an id to give (its session holds nothing)', () => {
  it('lets the real owner into the settings, and into nothing else that asks the owner', async () => {
    const owner = lockedByIds('OWNER');
    mocks.session.mockResolvedValue(owner);
    expect(await getSettingsOwner()).toBe(owner);
    expect(await requireSettingsManager()).toBe(owner);
    // the strict gate (the update notice's route, and every check built on it) stays closed
    expect(await getSettingsManager()).toBeNull();
  });

  it.each([
    ['a member', lockedByIds('MEMBER')],
    ['an admin who holds every permission', lockedByIds('MEMBER', true)],
    ['somebody waiting for approval', account('PENDING')],
    ['nobody signed in', null],
  ])('does not let %s into the settings', async (_who, session) => {
    mocks.session.mockResolvedValue(session);
    expect(await getSettingsOwner()).toBeNull();
    await expect(requireSettingsManager()).rejects.toThrow('Forbidden');
  });
});

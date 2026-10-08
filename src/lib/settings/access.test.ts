import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Who may open and change the settings: an OWNER, nobody else (an admin holding every permission included). */

const mocks = vi.hoisted(() => ({ session: vi.fn(), runtime: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: mocks.session }));
vi.mock('./runtime', () => ({ getRuntimeSettings: mocks.runtime }));

const { getSettingsManager, isSettingsEditable, requireSettingsManager } = await import('./access');

const account = (status: string, holdsAll = false) => ({
  user: { id: `u-${status}`, login: status.toLowerCase(), status, holdsAll, permissions: [] },
});

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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

/**
 * Who may follow, answer and ask for the publication of events on the intra (lib/events/access.ts): the rules of the three rights,
 * and the doors every page and action about it goes through. The same checks as access.test.ts, for the second half of the module.
 */

vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const {
  canFollowIntra,
  canPublishOnIntra,
  canRequestOnIntra,
  getEventsAccess,
  getIntraAccess,
  requireIntraPublisher,
  requireIntraRequester,
} = await import('./access');

type Who = AccountKind | { permissions: string[] } | null;

function platform(options: { events?: boolean; intra: boolean; who: Who }) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: options.events === false ? [] : ['events'] },
    events: { intraPublication: options.intra },
  } as unknown as ReturnType<typeof getConfig>);
  const { who } = options;
  vi.mocked(getEffectiveSession).mockResolvedValue(
    who === null
      ? null
      : typeof who === 'string'
        ? effectiveFor(who)
        : effective(memberWith(who.permissions)),
  );
}

const holder = (permissions: string[]) => ({ status: 'MEMBER' as const, permissions });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the three rights', () => {
  it('answers the requests with its own right, which includes nothing', () => {
    expect(canPublishOnIntra(holder(['events.intra_publish']))).toBe(true);
    expect(canPublishOnIntra(holder(['events.view', 'events.validate']))).toBe(false);
    expect(canPublishOnIntra(holder(['events.intra_view', 'events.intra_request']))).toBe(false);
  });

  it('asks with its own right, or by validating events', () => {
    expect(canRequestOnIntra(holder(['events.intra_request']))).toBe(true);
    expect(canRequestOnIntra(holder(['events.validate']))).toBe(true);
    expect(canRequestOnIntra(holder(['events.propose', 'events.view']))).toBe(false);
    expect(canRequestOnIntra(holder(['events.intra_publish']))).toBe(false);
    expect(canRequestOnIntra(holder(['events.intra_view']))).toBe(false);
  });

  it('follows with any of the rights about the intra, or by validating events; not by proposing or viewing', () => {
    for (const right of [
      'events.intra_view',
      'events.intra_publish',
      'events.intra_request',
      'events.validate',
    ]) {
      expect(canFollowIntra(holder([right]))).toBe(true);
    }
    expect(canFollowIntra(holder(['events.view', 'events.propose']))).toBe(false);
    expect(canFollowIntra(holder([]))).toBe(false);
  });

  it('never lets a PENDING account do any of it', () => {
    const pending = {
      status: 'PENDING' as const,
      permissions: ['events.intra_publish', 'events.intra_request', 'events.intra_view'],
    };
    expect(canPublishOnIntra(pending)).toBe(false);
    expect(canRequestOnIntra(pending)).toBe(false);
    expect(canFollowIntra(pending)).toBe(false);
  });
});

describe('getIntraAccess', () => {
  it('is null while the platform does not publish on the intra, whoever asks (nothing is read)', async () => {
    platform({ intra: false, who: 'OWNER' });
    await expect(getIntraAccess()).resolves.toBeNull();
    expect(getEffectiveSession).not.toHaveBeenCalled();
  });

  it('is null when the events module is off', async () => {
    platform({ events: false, intra: true, who: 'OWNER' });
    await expect(getIntraAccess()).resolves.toBeNull();
  });

  it.each<[string, Who]>([
    ['nobody signed in', null],
    ['a PENDING account', 'PENDING'],
    ['a default member', 'MEMBER'],
    ['a role that proposes', { permissions: ['events.view', 'events.propose'] }],
    ['a role of another module', { permissions: ['members.manage'] }],
  ])('is null for %s', async (_label, who) => {
    platform({ intra: true, who });
    await expect(getIntraAccess()).resolves.toBeNull();
  });

  it('gives the staff the right to answer and nothing to ask, and not the calendar', async () => {
    platform({ intra: true, who: { permissions: ['events.intra_publish'] } });
    await expect(getIntraAccess()).resolves.toMatchObject({ canPublish: true, canRequest: false });
    await expect(getEventsAccess()).resolves.toBeNull();
  });

  it('gives a validator the right to ask and not to answer', async () => {
    platform({ intra: true, who: { permissions: ['events.view', 'events.validate'] } });
    await expect(getIntraAccess()).resolves.toMatchObject({ canPublish: false, canRequest: true });
  });

  it('gives a follower neither', async () => {
    platform({ intra: true, who: { permissions: ['events.intra_view'] } });
    await expect(getIntraAccess()).resolves.toMatchObject({ canPublish: false, canRequest: false });
  });

  it('gives the owner both', async () => {
    platform({ intra: true, who: 'OWNER' });
    await expect(getIntraAccess()).resolves.toMatchObject({ canPublish: true, canRequest: true });
  });
});

describe('requireIntraPublisher and requireIntraRequester', () => {
  it.each<[string, Parameters<typeof platform>[0]]>([
    ['the platform does not publish on the intra', { intra: false, who: 'OWNER' }],
    ['no session', { intra: true, who: null }],
    [
      'a validator (who asks, and does not answer)',
      { intra: true, who: { permissions: ['events.validate'] } },
    ],
    ['a follower', { intra: true, who: { permissions: ['events.intra_view'] } }],
  ])('throws Forbidden to answer: %s', async (_label, options) => {
    platform(options);
    await expect(requireIntraPublisher()).rejects.toThrow('Forbidden');
  });

  it.each<[string, Parameters<typeof platform>[0]]>([
    ['the platform does not publish on the intra', { intra: false, who: 'OWNER' }],
    ['no session', { intra: true, who: null }],
    [
      'the staff (who answers, and does not ask)',
      { intra: true, who: { permissions: ['events.intra_publish'] } },
    ],
    ['a follower', { intra: true, who: { permissions: ['events.intra_view'] } }],
  ])('throws Forbidden to ask: %s', async (_label, options) => {
    platform(options);
    await expect(requireIntraRequester()).rejects.toThrow('Forbidden');
  });

  it('lets in who is meant to', async () => {
    platform({ intra: true, who: { permissions: ['events.intra_publish'] } });
    await expect(requireIntraPublisher()).resolves.toMatchObject({ canPublish: true });
    platform({ intra: true, who: { permissions: ['events.intra_request'] } });
    await expect(requireIntraRequester()).resolves.toMatchObject({ canRequest: true });
    platform({ intra: true, who: { permissions: ['events.validate'] } });
    await expect(requireIntraRequester()).resolves.toMatchObject({ canRequest: true });
  });
});

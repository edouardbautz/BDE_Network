import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { sessionFor, type AccountKind } from '@/test/session-fixtures';

/**
 * The (app) layout is the first gate every /dashboard, /members and
 * /audit-log request passes through. Proves it turns away anonymous and
 * PENDING requests before any page-specific code (or data query) runs.
 */

const { RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  }
  return { RedirectSignal };
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/health', () => ({ isDatabaseReachable: vi.fn(async () => true) }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((opts: { href: string }) => {
    throw new RedirectSignal(opts.href);
  }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async () => (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  ),
}));
vi.mock('@/lib/events/queries', () => ({ countProposals: vi.fn(async () => 0) }));
// The platform of these tests does not publish on the intra, unless a test says so.
vi.mock('@/lib/events/intra-queries', () => ({ countIntraToDo: vi.fn(async () => 0) }));
vi.mock('@/lib/events/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/access')>()),
  getIntraAccess: vi.fn(async () => null),
}));

const { auth } = await import('@/lib/auth');
const { redirect } = await import('@/i18n/navigation');
const { isDatabaseReachable } = await import('@/lib/health');
const { countProposals } = await import('@/lib/events/queries');
const { countIntraToDo } = await import('@/lib/events/intra-queries');
const { getIntraAccess } = await import('@/lib/events/access');
const { default: AppLayout } = await import('./layout');
const { memberWith } = await import('@/test/session-fixtures');

// NextAuth's `auth` export is overloaded (plain call / middleware / route
// wrapper) — pin it to the plain-call signature so `vi.mocked` doesn't
// resolve to an unrelated overload.
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

function callLayout() {
  return AppLayout({ children: null, params: Promise.resolve({ locale: 'fr' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('(app) layout — the shared gate for /dashboard, /members, /audit-log', () => {
  it('redirects anonymous visitors to the login page', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/' }));
  });

  // With the database down Auth.js reports no session for everyone, signed in or not.
  it('shows the "service unavailable" page, not the login page, when the database is down', async () => {
    mockAuth.mockResolvedValue(null);
    vi.mocked(isDatabaseReachable).mockResolvedValueOnce(false);

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/unavailable' }));
  });

  it('redirects a PENDING user to the waiting page', async () => {
    mockAuth.mockResolvedValue(sessionFor('PENDING'));

    await expect(callLayout()).rejects.toThrow(RedirectSignal);

    expect(redirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/pending' }));
  });

  it.each<AccountKind>(['MEMBER', 'ADMIN', 'OWNER'])(
    'lets a %s user through to the app shell',
    async (kind) => {
      mockAuth.mockResolvedValue(sessionFor(kind));

      await expect(callLayout()).resolves.toBeTruthy();

      expect(redirect).not.toHaveBeenCalled();
    },
  );
});

describe('(app) layout — the menu entry of the settings', () => {
  const navIds = async () => {
    const shell = (await callLayout()) as { props: { navItems: { id: string }[] } };
    return shell.props.navItems.map((item) => item.id);
  };

  it('is offered to an owner', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    expect(await navIds()).toContain('settings');
  });

  // An admin holds every permission, and still is not an owner: the settings decide who may do anything at all.
  it.each<AccountKind>(['ADMIN', 'MEMBER'])('is not offered to a %s', async (kind) => {
    mockAuth.mockResolvedValue(sessionFor(kind));
    expect(await navIds()).not.toContain('settings');
  });
});

describe('(app) layout — the entry that counts the proposals to validate', () => {
  const entry = async () => {
    const shell = (await callLayout()) as {
      props: { navItems: { id: string; badge?: number; badgeLabel?: string }[] };
    };
    return shell.props.navItems.find((item) => item.id === 'eventsReview');
  };

  it('is offered to somebody who can validate events, with how many wait', async () => {
    vi.mocked(countProposals).mockResolvedValue(3);
    mockAuth.mockResolvedValue(memberWith(['events.validate']));
    expect(await entry()).toMatchObject({
      href: '/events/review',
      badge: 3,
      badgeLabel: 'eventsReviewCount:3',
    });
  });

  it('is offered to an admin and an owner, who hold every permission', async () => {
    for (const kind of ['ADMIN', 'OWNER'] as const) {
      mockAuth.mockResolvedValue(sessionFor(kind));
      expect(await entry()).toBeDefined();
    }
  });

  // Somebody who only proposes cannot answer: no entry, and no query for a count they will not see.
  it.each<[string, string[]]>([
    ['who only proposes', ['events.propose']],
    ['who only views', ['events.view']],
    ['of another module', ['members.manage']],
  ])('is not offered to a member %s, and nothing is counted', async (_label, permissions) => {
    mockAuth.mockResolvedValue(memberWith(permissions));
    vi.mocked(countProposals).mockClear();
    expect(await entry()).toBeUndefined();
    expect(countProposals).not.toHaveBeenCalled();
  });
});

describe('(app) layout — the entry that counts what the staff has to publish on the intra', () => {
  const entry = async () => {
    const shell = (await callLayout()) as {
      props: { navItems: { id: string; badge?: number; badgeLabel?: string }[] };
    };
    return shell.props.navItems.find((item) => item.id === 'eventsIntra');
  };
  const access = (canPublish: boolean) =>
    ({ canPublish, canRequest: false }) as Awaited<ReturnType<typeof getIntraAccess>>;

  it('is offered to the staff, with how many requests wait', async () => {
    mockAuth.mockResolvedValue(memberWith(['events.intra_publish']));
    vi.mocked(getIntraAccess).mockResolvedValue(access(true));
    vi.mocked(countIntraToDo).mockResolvedValue(4);
    expect(await entry()).toMatchObject({
      href: '/events/intra',
      badge: 4,
      badgeLabel: 'eventsIntraCount:4',
    });
  });

  it('is offered to somebody who only follows, with no count and no query for one', async () => {
    mockAuth.mockResolvedValue(memberWith(['events.intra_view']));
    vi.mocked(getIntraAccess).mockResolvedValue(access(false));
    vi.mocked(countIntraToDo).mockClear();
    expect(await entry()).toMatchObject({ href: '/events/intra', badge: 0 });
    expect(countIntraToDo).not.toHaveBeenCalled();
  });

  it('is not offered when the platform does not publish on the intra, or to somebody with no right to it', async () => {
    mockAuth.mockResolvedValue(sessionFor('OWNER'));
    vi.mocked(getIntraAccess).mockResolvedValue(null);
    vi.mocked(countIntraToDo).mockClear();
    expect(await entry()).toBeUndefined();
    expect(countIntraToDo).not.toHaveBeenCalled();
  });

  it('does not make the staff see the calendar: the entry of the intra is there, the one of the events is not', async () => {
    mockAuth.mockResolvedValue(memberWith(['events.intra_publish']));
    vi.mocked(getIntraAccess).mockResolvedValue(access(true));
    const shell = (await callLayout()) as { props: { navItems: { id: string }[] } };
    const ids = shell.props.navItems.map((item) => item.id);
    expect(ids).toContain('eventsIntra');
    expect(ids).not.toContain('events');
    expect(ids).not.toContain('members');
  });
});

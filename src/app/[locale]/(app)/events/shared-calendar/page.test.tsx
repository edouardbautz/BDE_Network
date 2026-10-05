import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';
import { effective, effectiveFor, memberWith, type AccountKind } from '@/test/session-fixtures';

const { NotFoundSignal, RedirectSignal } = vi.hoisted(() => ({
  NotFoundSignal: class NotFoundSignal extends Error {},
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'fr'),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/config', () => ({ getConfig: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/events/export', () => ({ getBdeFeedToken: vi.fn() }));
vi.mock('@/lib/events/origin', () => ({ getOrigin: vi.fn(async () => 'https://bde.example') }));
vi.mock('./actions', () => ({
  enableSharedCalendar: vi.fn(),
  regenerateSharedCalendar: vi.fn(),
  disableSharedCalendar: vi.fn(),
}));

const { getConfig } = await import('@/config');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { getBdeFeedToken } = await import('@/lib/events/export');
const { default: SharedCalendarPage } = await import('./page');

const TOKEN = 'T'.repeat(43);

type Who = AccountKind | { permissions: string[] } | null;

function access(who: Who, moduleEnabled = true) {
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: moduleEnabled ? ['events'] : [] },
  } as unknown as ReturnType<typeof getConfig>);
  vi.mocked(getEffectiveSession).mockResolvedValue(
    who === null
      ? null
      : typeof who === 'string'
        ? effectiveFor(who)
        : effective(memberWith(who.permissions)),
  );
}

const page = async (search: { status?: string } = {}) =>
  renderToHtml(<>{await SharedCalendarPage({ searchParams: Promise.resolve(search) })}</>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/events/shared-calendar', () => {
  it('is a 404 when the module is disabled, even for the owner', async () => {
    access('OWNER', false);
    await expect(page()).rejects.toThrow(NotFoundSignal);
    expect(getBdeFeedToken).not.toHaveBeenCalled();
  });

  it('is a 404 when nobody is signed in', async () => {
    access(null);
    await expect(page()).rejects.toThrow(NotFoundSignal);
  });

  it.each<[string, Who]>([
    ['the default member', 'MEMBER'],
    [
      'a role that manages events but not the shared calendar',
      { permissions: ['events.view', 'events.manage'] },
    ],
  ])('sends %s back to the events without ever reading the token', async (_label, who) => {
    access(who);
    await expect(page()).rejects.toThrow(new RedirectSignal('/events'));
    expect(getBdeFeedToken).not.toHaveBeenCalled();
  });

  it.each<[string, Who]>([
    ['an admin', 'ADMIN'],
    ['the owner', 'OWNER'],
    [
      'a role with only the shared-calendar permission',
      { permissions: ['events.shared_calendar'] },
    ],
  ])('shows %s the activation prompt when the link is off', async (_label, who) => {
    access(who);
    vi.mocked(getBdeFeedToken).mockResolvedValue(null);
    const html = await page();
    expect(html).toContain('inactive.enable');
    expect(html).not.toContain('/api/calendar/bde/');
  });

  it.each<[string, Who]>([
    ['an admin', 'ADMIN'],
    ['the owner', 'OWNER'],
  ])('shows %s the link and management controls when it is on', async (_label, who) => {
    access(who);
    vi.mocked(getBdeFeedToken).mockResolvedValue(TOKEN);
    const html = await page();

    expect(html).toContain(`https://bde.example/api/calendar/bde/${TOKEN}.ics`);
    expect(html).toContain('regenerate.confirm');
    expect(html).toContain('disable.confirm');
    expect(html).toContain('active.confirmedOnly');
    expect(html).toContain('active.limit');
  });

  it('shows the outcome banner for a known status only', async () => {
    access('ADMIN');
    vi.mocked(getBdeFeedToken).mockResolvedValue(TOKEN);
    expect(await page({ status: 'regenerated' })).toContain('status.regenerated');
    expect(await page({ status: '<img src=x>' })).not.toContain('<img src=x>');
  });
});

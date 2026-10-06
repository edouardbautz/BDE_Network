import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';

/**
 * Page-level checks for the events module: who is turned away before any data
 * is read, and what each audience actually receives in the HTML (the create /
 * edit / delete controls must not be rendered for a plain member, and drafts
 * must never be requested on their behalf).
 */

const { NotFoundSignal, RedirectSignal } = vi.hoisted(() => ({
  NotFoundSignal: class NotFoundSignal extends Error {},
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

type Href = string | { pathname: string; query?: Record<string, string | number> };

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'fr'),
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  ),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
  Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode }) => (
    <a href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { timezone: 'Europe/Paris', name: 'BDE Test' },
    modules: { enabled: ['events'] },
    notifications: { eventConfirmed: 'email' },
    events: {
      categories: [
        { key: 'soiree', label: 'Soirée', color: '#db2777' },
        { key: 'sport', label: 'Sport', color: '#16a34a' },
      ],
    },
  })),
}));
vi.mock('@/lib/events/access', () => ({
  getEventsAccess: vi.fn(),
  // The real rule is covered in access.test.ts; page tests only need its outcome.
  canManageSharedCalendar: (user: { permissions: string[] }) =>
    user.permissions.includes('events.shared_calendar'),
}));
vi.mock('@/lib/events/queries', () => ({
  getFilterOptions: vi.fn(async () => ({ schoolYears: [], assignees: [] })),
  listOccurrences: vi.fn(async () => []),
  listUpcomingOccurrences: vi.fn(async () => []),
  getVisibleEvent: vi.fn(),
  listAssignableMembers: vi.fn(async () => [{ login: 'alice', name: 'Alice A' }]),
}));
vi.mock('./actions', () => ({
  createEvent: vi.fn(),
  updateEvent: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }),
  deleteEvent: vi.fn(),
  setEventStatus: vi.fn(),
  cancelOccurrence: vi.fn(),
  restoreOccurrence: vi.fn(),
}));

const { getEventsAccess } = await import('@/lib/events/access');
const { getVisibleEvent, listOccurrences, listUpcomingOccurrences } =
  await import('@/lib/events/queries');
const { default: EventsPage } = await import('./page');
const { default: EventDetailPage } = await import('./[id]/page');
const { default: NewEventPage } = await import('./new/page');
const { default: EditEventPage } = await import('./[id]/edit/page');

type Access = Awaited<ReturnType<typeof getEventsAccess>>;
const asMember = {
  canManage: false,
  session: { user: { permissions: ['events.view'] } },
} as unknown as Access;
const asManager = {
  canManage: true,
  session: { user: { permissions: ['events.view', 'events.manage'] } },
} as unknown as Access;
// Holds the shared-calendar permission without being able to manage events.
const asCalendarManager = {
  canManage: false,
  session: { user: { permissions: ['events.view', 'events.shared_calendar'] } },
} as unknown as Access;

const storedEvent = {
  id: 'evt1',
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Salle B',
  categoryKey: 'soiree',
  status: 'CONFIRMED' as const,
  startsAt: new Date('2099-10-10T18:00:00Z'),
  endsAt: new Date('2099-10-10T20:00:00Z'),
  recurrence: 'NONE' as const,
  recurrenceUntil: null,
  schoolYear: '2099-2100',
  authorLogin: 'alice',
  confirmationNotifiedAt: null,
  assignees: [{ login: 'alice', userId: 'u1', user: { fullName: 'Alice A' } }],
  cancellations: [],
};

const series = {
  ...storedEvent,
  recurrence: 'WEEKLY' as const,
  recurrenceUntil: new Date('2099-10-31T00:00:00Z'),
};

const renderPage = async (page: Promise<ReactNode>) => renderToHtml(<>{await page}</>);
const eventsPage = (search: Record<string, string> = {}) =>
  renderPage(EventsPage({ searchParams: Promise.resolve(search) }));
const detailPage = (search: Record<string, string> = {}) =>
  renderPage(
    EventDetailPage({
      params: Promise.resolve({ id: 'evt1' }),
      searchParams: Promise.resolve(search),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/events', () => {
  it('is a 404 when the module is disabled or the visitor has no access', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(null);
    await expect(eventsPage()).rejects.toThrow(NotFoundSignal);
    expect(listOccurrences).not.toHaveBeenCalled();
    expect(listUpcomingOccurrences).not.toHaveBeenCalled();
  });

  it('never asks for drafts on behalf of a plain member, and shows no create button', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const html = await eventsPage();

    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: false }));
    expect(listUpcomingOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ includeDrafts: false }),
    );
    expect(html).not.toContain('href="/events/new"');
  });

  it('asks for drafts and offers the create button to a manager', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    const html = await eventsPage();

    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: true }));
    expect(html).toContain('href="/events/new"');
  });

  it('offers the shared-calendar entry only with its own permission, whatever the events permission', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asCalendarManager);
    expect(await eventsPage()).toContain('href="/events/shared-calendar"');

    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    expect(await eventsPage()).not.toContain('/events/shared-calendar');

    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    expect(await eventsPage()).not.toContain('/events/shared-calendar');
  });

  it('shows a designed empty state instead of a blank list', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const html = await eventsPage({ view: 'list' });
    expect(html).toContain('empty.title');
    expect(html).toContain('empty.description');
  });

  it('shows the filtered empty state when filters match nothing', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const html = await eventsPage({ view: 'list', category: 'sport' });
    expect(html).toContain('empty.filteredTitle');
    expect(listUpcomingOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ categoryKey: 'sport' }) }),
    );
  });

  it('adapts to the screen by default: calendar from md up, list below', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const html = await eventsPage();
    expect(html).toContain('class="hidden md:block"');
    expect(html).toContain('class="md:hidden"');
    expect(listOccurrences).toHaveBeenCalled();
    expect(listUpcomingOccurrences).toHaveBeenCalled();
  });

  it('honours an explicit view and loads only what that view needs', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    await eventsPage({ view: 'list' });
    expect(listOccurrences).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    await eventsPage({ view: 'calendar' });
    expect(listUpcomingOccurrences).not.toHaveBeenCalled();
  });

  it('ignores a filter value that is not a real category', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    await eventsPage({ view: 'list', category: "x' OR 1=1" });
    expect(listUpcomingOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ categoryKey: undefined }) }),
    );
  });
});

describe('/events/[id]', () => {
  it('is a 404 without access', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(null);
    await expect(detailPage()).rejects.toThrow(NotFoundSignal);
    expect(getVisibleEvent).not.toHaveBeenCalled();
  });

  it('is a 404 for an event the user may not see (a draft, for a plain member)', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    vi.mocked(getVisibleEvent).mockResolvedValue(null);
    await expect(detailPage()).rejects.toThrow(NotFoundSignal);
    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', false);
  });

  it('shows the details and the calendar download to a plain member, without any management control', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await detailPage();

    expect(html).toContain('Soirée de rentrée');
    expect(html).toContain('Salle B');
    expect(html).toContain('Alice A');
    expect(html).toContain('/api/events/evt1/ics?occ=');
    expect(html).not.toContain('/events/evt1/edit');
    expect(html).not.toContain('detail.delete.button');
    expect(html).not.toContain('detail.confirm');
  });

  it('gives a manager the edit, status and delete controls', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await detailPage();

    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', true);
    expect(html).toContain('/events/evt1/edit');
    expect(html).toContain('detail.delete.button');
    expect(html).toContain('detail.backToDraft');
  });

  it('offers a draft to be confirmed (through a dialog), and a confirmed event to go back to draft (directly)', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);

    vi.mocked(getVisibleEvent).mockResolvedValue({ ...storedEvent, status: 'DRAFT' } as never);
    const draftHtml = await detailPage();
    expect(draftHtml).toContain('detail.confirm');
    expect(draftHtml).not.toContain('detail.backToDraft');

    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const confirmedHtml = await detailPage();
    expect(confirmedHtml).toContain('detail.backToDraft');
    expect(confirmedHtml).not.toContain('detail.confirm');
  });

  it('lists the occurrences of a series, with cancel buttons for managers only', async () => {
    vi.mocked(getVisibleEvent).mockResolvedValue(series as never);

    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const memberHtml = await detailPage();
    expect(memberHtml).toContain('detail.occurrences.title');
    expect(memberHtml).not.toContain('detail.occurrences.cancel');

    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    const managerHtml = await detailPage();
    expect(managerHtml).toContain('detail.occurrences.cancel');
    expect(managerHtml).toContain('detail.addSeriesToCalendar');
  });

  it('marks a cancelled occurrence and offers to restore it to managers', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    vi.mocked(getVisibleEvent).mockResolvedValue({
      ...series,
      cancellations: [{ occurrenceStart: new Date('2099-10-17T18:00:00Z') }],
    } as never);
    const html = await detailPage();
    expect(html).toContain('detail.occurrences.restore');
    expect(html).toContain('line-through');
  });
});

describe('/events/new and /events/[id]/edit', () => {
  it('are 404 without access', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(null);
    await expect(renderPage(NewEventPage())).rejects.toThrow(NotFoundSignal);
    await expect(
      renderPage(EditEventPage({ params: Promise.resolve({ id: 'evt1' }) })),
    ).rejects.toThrow(NotFoundSignal);
  });

  it('send a plain member back instead of showing the form', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    await expect(renderPage(NewEventPage())).rejects.toThrow(new RedirectSignal('/events'));
    await expect(
      renderPage(EditEventPage({ params: Promise.resolve({ id: 'evt1' }) })),
    ).rejects.toThrow(new RedirectSignal('/events/evt1'));
    expect(getVisibleEvent).not.toHaveBeenCalled();
  });

  it('show the form to a manager, with the configured categories', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    const html = await renderPage(NewEventPage());
    expect(html).toContain('form.createTitle');
    expect(html).toContain('>Soirée<');
    expect(html).toContain('>Sport<');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('Alice A');
  });

  it('prefill the edit form from the stored event, in the BDE timezone', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asManager);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await renderPage(EditEventPage({ params: Promise.resolve({ id: 'evt1' }) }));
    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', true);
    // 18:00Z on 10 Oct 2099 is 20:00 in Paris (UTC+2)
    expect(html).toContain('value="2099-10-10T20:00"');
    expect(html).toContain('value="Soirée de rentrée"');
  });
});

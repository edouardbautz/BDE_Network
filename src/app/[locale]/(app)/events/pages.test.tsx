import { notificationsConfig } from '@/test/notifications';
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
  useLocale: () => 'fr',
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
  Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode }) => (
    <a
      href={
        typeof href === 'string'
          ? href
          : `${href.pathname}${href.query ? `?${new URLSearchParams(Object.entries(href.query).map(([k, v]) => [k, String(v)]))}` : ''}`
      }
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { timezone: 'Europe/Paris', name: 'BDE Test' },
    modules: { enabled: ['events'] },
    notifications: notificationsConfig({ eventConfirmed: 'email' }),
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
  listProposals: vi.fn(async () => []),
  listAssignableMembers: vi.fn(async () => [{ login: 'alice', name: 'Alice A' }]),
}));
vi.mock('./actions', () => ({
  createEvent: vi.fn(),
  updateEvent: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }),
  deleteEvent: vi.fn(),
  setEventStatus: vi.fn(),
  refuseEvent: vi.fn(),
  cancelOccurrence: vi.fn(),
  restoreOccurrence: vi.fn(),
}));

const { getEventsAccess } = await import('@/lib/events/access');
const { getVisibleEvent, listOccurrences, listProposals, listUpcomingOccurrences } =
  await import('@/lib/events/queries');
const { default: EventsPage } = await import('./page');
const { default: EventDetailPage } = await import('./[id]/page');
const { default: NewEventPage } = await import('./new/page');
const { default: EditEventPage } = await import('./[id]/edit/page');
const { default: ReviewPage } = await import('./review/page');

type Access = Awaited<ReturnType<typeof getEventsAccess>>;

/** What the events access is for somebody who holds these permissions (as the session resolves them). */
function accessFor(permissions: string[], login = 'bob'): Access {
  const canPropose = permissions.includes('events.propose');
  const canValidate = permissions.includes('events.validate');
  return {
    canPropose,
    canValidate,
    canCreate: canPropose || canValidate,
    session: { user: { login, permissions } },
  } as unknown as Access;
}

const asMember = accessFor(['events.view']);
const asValidator = accessFor(['events.view', 'events.propose', 'events.validate']);
// Alice wrote the stored events below: she only proposes.
const asProposer = accessFor(['events.view', 'events.propose'], 'alice');
// Holds the shared-calendar permission without being able to create or validate events.
const asCalendarManager = accessFor(['events.view', 'events.shared_calendar']);

const storedEvent = {
  id: 'evt1',
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Salle B',
  categoryKey: 'soiree',
  status: 'CONFIRMED' as const,
  startsAt: new Date('2099-10-10T18:00:00Z'),
  endsAt: new Date('2099-10-10T20:00:00Z'),
  repeat: null,
  recurrenceUntil: null,
  schoolYear: '2099-2100',
  authorLogin: 'alice',
  confirmationNotifiedAt: null,
  updatedAt: new Date('2099-01-01T00:00:00Z'),
  assignees: [{ login: 'alice', userId: 'u1', user: { fullName: 'Alice A' } }],
  cancellations: [],
  occurrences: [],
};

const series = {
  ...storedEvent,
  repeat: { freq: 'WEEKLY', interval: 1 },
  recurrenceUntil: new Date('2099-10-31T00:00:00Z'),
};

const renderPage = async (page: Promise<ReactNode>) => renderToHtml(<>{await page}</>);
const newEventPage = (search: Record<string, string> = {}) =>
  NewEventPage({ searchParams: Promise.resolve(search) });
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
    expect(html).not.toContain('/events/new');
  });

  it('asks for drafts and offers the create button to a validator', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await eventsPage();

    expect(listOccurrences).toHaveBeenCalledWith(expect.objectContaining({ includeDrafts: true }));
    expect(html).toContain('href="/events/new"');
  });

  it('gives whoever can create events, and only them, the "+" of each day of the calendar', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await eventsPage({ view: 'calendar', month: '2026-10' });
    expect(html).toContain('href="/events/new?date=2026-10-20"');
    expect(html).toContain('id="add-on-selected-day"');

    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const forMember = await eventsPage({ view: 'calendar', month: '2026-10' });
    expect(forMember).not.toContain('/events/new');
    expect(forMember).not.toContain('add-on-selected-day');

    // Somebody who only proposes creates events too (as proposals).
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    const forProposer = await eventsPage({ view: 'calendar', month: '2026-10' });
    expect(forProposer).toContain('href="/events/new?date=2026-10-20"');
  });

  it("shows a proposer their own events that are not published, and nobody else's", async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    const html = await eventsPage();

    expect(listOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ includeDrafts: false, ownLogin: 'alice' }),
    );
    expect(listUpcomingOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ includeDrafts: false, ownLogin: 'alice' }),
    );
    expect(html).toContain('href="/events/new"');
  });

  it('offers the shared-calendar entry only with its own permission, whatever the events permission', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asCalendarManager);
    expect(await eventsPage()).toContain('href="/events/shared-calendar"');

    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
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
    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', { includeDrafts: false });
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

  it('writes the facts as a description list a screen reader can read: terms and descriptions, and nothing else', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    vi.mocked(getVisibleEvent).mockResolvedValue(series as never);
    const document = new DOMParser().parseFromString(await detailPage(), 'text/html');

    const lists = [...document.querySelectorAll('dl')];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      const groups = [...list.children];
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        // A direct child is a term, a description, or a div that holds only terms and descriptions.
        if (group.tagName === 'DIV') {
          expect(group.children.length).toBeGreaterThan(0);
          for (const child of group.children) expect(['DT', 'DD']).toContain(child.tagName);
        } else {
          expect(['DT', 'DD']).toContain(group.tagName);
        }
      }
    }
    // And every term and description is in such a list (none is left loose, whatever holds it).
    for (const item of document.querySelectorAll('dt, dd')) {
      expect(item.closest('dl'), item.outerHTML).not.toBeNull();
      expect(
        item.parentElement?.tagName === 'DL' || item.parentElement?.parentElement?.tagName === 'DL',
      ).toBe(true);
    }
  });

  it('gives a validator the edit, status and delete controls', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await detailPage();

    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', { includeDrafts: true });
    expect(html).toContain('/events/evt1/edit');
    expect(html).toContain('detail.delete.button');
    expect(html).toContain('detail.backToDraft');
  });

  it('offers a draft to be confirmed (through a dialog), and a confirmed event to go back to draft (directly)', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);

    vi.mocked(getVisibleEvent).mockResolvedValue({ ...storedEvent, status: 'DRAFT' } as never);
    const draftHtml = await detailPage();
    expect(draftHtml).toContain('detail.confirm');
    expect(draftHtml).not.toContain('detail.backToDraft');

    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const confirmedHtml = await detailPage();
    expect(confirmedHtml).toContain('detail.backToDraft');
    expect(confirmedHtml).not.toContain('detail.confirm');
  });

  it('lists the dates of a series for everybody, and gives managers one delete control for a date or the following', async () => {
    vi.mocked(getVisibleEvent).mockResolvedValue(series as never);

    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const memberHtml = await detailPage();
    expect(memberHtml).toContain('detail.occurrences.title');
    expect(memberHtml).not.toContain('scope.delete.button');

    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const managerHtml = await detailPage();
    expect(managerHtml).toContain('scope.delete.button');
    expect(managerHtml).not.toContain('detail.delete.button');
    expect(managerHtml).toContain('detail.addSeriesToCalendar');
    // The edit link opens the form on the date that is shown.
    expect(managerHtml).toMatch(/\/events\/evt1\/edit\?occ=\d+/);
  });

  it('keeps the single delete button for an event that does not repeat', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await detailPage();
    expect(html).toContain('detail.delete.button');
    expect(html).not.toContain('scope.delete.button');
    expect(html).not.toMatch(/edit\?occ=/);
  });

  it('shows the date asked for with what it has of its own, and says so', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const second = new Date('2099-10-17T18:00:00Z');
    vi.mocked(getVisibleEvent).mockResolvedValue({
      ...series,
      occurrences: [
        {
          occurrenceStart: second,
          title: 'Soirée spéciale',
          description: null,
          location: 'Dehors',
          categoryKey: null,
          status: null,
          startsAt: null,
          endsAt: null,
          assigneesOverridden: false,
          confirmationNotifiedAt: null,
          updatedAt: new Date('2099-01-01T00:00:00Z'),
          assignees: [],
        },
      ],
    } as never);

    const html = await detailPage({ occ: String(second.getTime()) });
    expect(html).toContain('Soirée spéciale');
    expect(html).toContain('Dehors');
    expect(html).not.toContain('Salle B');
    expect(html).toContain('detail.occurrenceEdited');
    // The other dates keep the series' values.
    const first = await detailPage({ occ: String(new Date('2099-10-10T18:00:00Z').getTime()) });
    expect(first).toContain('Salle B');
  });

  it('shows a reader who cannot see drafts only the confirmed dates of a series', async () => {
    const second = new Date('2099-10-17T18:00:00Z');
    const draftSeries = {
      ...series,
      status: 'DRAFT' as const,
      occurrences: [
        {
          occurrenceStart: second,
          title: null,
          description: null,
          location: null,
          categoryKey: null,
          status: 'CONFIRMED' as const,
          startsAt: null,
          endsAt: null,
          assigneesOverridden: false,
          confirmationNotifiedAt: new Date('2099-01-01T00:00:00Z'),
          updatedAt: new Date('2099-01-01T00:00:00Z'),
          assignees: [],
        },
      ],
    };
    vi.mocked(getVisibleEvent).mockResolvedValue(draftSeries as never);

    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    const memberHtml = await detailPage();
    expect(memberHtml).toContain(`occ=${second.getTime()}`);
    expect(memberHtml).not.toContain(`occ=${new Date('2099-10-10T18:00:00Z').getTime()}`);
    expect(memberHtml).not.toContain(`occ=${new Date('2099-10-24T18:00:00Z').getTime()}`);

    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const managerHtml = await detailPage();
    expect(managerHtml).toContain(`occ=${new Date('2099-10-24T18:00:00Z').getTime()}`);
  });

  it('marks a cancelled occurrence and offers to restore it to managers', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
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
    await expect(renderPage(newEventPage())).rejects.toThrow(NotFoundSignal);
    await expect(
      renderPage(
        EditEventPage({
          params: Promise.resolve({ id: 'evt1' }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ).rejects.toThrow(NotFoundSignal);
  });

  it('send a plain member back instead of showing the form', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asMember);
    await expect(renderPage(newEventPage())).rejects.toThrow(new RedirectSignal('/events'));
    // the day in the address changes nothing for them
    await expect(renderPage(newEventPage({ date: '2026-10-20' }))).rejects.toThrow(
      new RedirectSignal('/events'),
    );
    await expect(
      renderPage(
        EditEventPage({
          params: Promise.resolve({ id: 'evt1' }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ).rejects.toThrow(new RedirectSignal('/events/evt1'));
    expect(getVisibleEvent).not.toHaveBeenCalled();
  });

  it('show the form to a validator, with the configured categories', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await renderPage(newEventPage());
    expect(html).toContain('form.createTitle');
    expect(html).toContain('>Soirée<');
    expect(html).toContain('>Sport<');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('Alice A');
  });

  it('start the form on the day of the "+", at 18:00–20:00 in the BDE timezone', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await renderPage(newEventPage({ date: '2026-11-07' }));
    expect(html).toContain('value="2026-11-07T18:00"');
    expect(html).toContain('value="2026-11-07T20:00"');
    // cancelling goes back to that day of the calendar
    expect(html).toContain('href="/events?view=calendar&amp;month=2026-11&amp;day=2026-11-07"');
  });

  it('accept a day in the past: an event can be recorded after the fact', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await renderPage(newEventPage({ date: '2025-01-02' }));
    expect(html).toContain('value="2025-01-02T18:00"');
  });

  it.each(['tomorrow', '2026-02-30', '2026-13-01', '1999-01-01', '<script>', ''])(
    'ignore %j in the address and start from tomorrow, as from the button',
    async (date) => {
      vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
      const html = await renderPage(newEventPage({ date }));
      expect(html).toMatch(/value="\d{4}-\d{2}-\d{2}T18:00"/);
      expect(html).not.toContain('value="2026-02-30');
      expect(html).toContain('href="/events"');
    },
  );

  it('prefill the edit form from the stored event, in the BDE timezone', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    const html = await renderPage(
      EditEventPage({ params: Promise.resolve({ id: 'evt1' }), searchParams: Promise.resolve({}) }),
    );
    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', { includeDrafts: true });
    // 18:00Z on 10 Oct 2099 is 20:00 in Paris (UTC+2)
    expect(html).toContain('value="2099-10-10T20:00"');
    expect(html).toContain('value="Soirée de rentrée"');
  });
});

describe('/events/[id]/edit on a series that ends after some dates', () => {
  const counted = {
    ...storedEvent,
    repeat: { freq: 'WEEKLY', interval: 1, count: 4 },
    // 4 Saturdays from 10 October 2099
    recurrenceUntil: new Date('2099-10-31T19:00:00Z'),
  };
  const countOf = async (occ?: number) => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(getVisibleEvent).mockResolvedValue(counted as never);
    const html = await renderPage(
      EditEventPage({
        params: Promise.resolve({ id: 'evt1' }),
        searchParams: Promise.resolve(occ === undefined ? {} : { occ: String(occ) }),
      }),
    );
    return /<input[^>]*id="repeatCount"[^>]*>/.exec(html)?.[0];
  };

  it('says the number of dates of the series from its first date', async () => {
    expect(await countOf()).toContain('value="4"');
  });

  it('says how many are left from a later date, not the total again', async () => {
    // the 3rd Saturday: it and the next one are left
    expect(await countOf(new Date('2099-10-24T18:00:00Z').getTime())).toContain('value="2"');
    // (the event is at 20:00 in Paris: the clocks went back on 25 October, so it is 19:00Z)
    expect(await countOf(new Date('2099-10-31T19:00:00Z').getTime())).toContain('value="1"');
  });
});

describe('/events/[id] in the proposal circuit', () => {
  const refused = {
    refusalComment: 'Pas ce jour-là, la salle est prise.',
    refusedByLogin: 'bob',
    refusedAt: new Date('2099-01-05T10:00:00Z'),
  };
  const proposed = {
    ...storedEvent,
    status: 'PROPOSED' as const,
    proposedAt: new Date('2099-01-02T10:00:00Z'),
  };
  const draft = { ...storedEvent, status: 'DRAFT' as const };
  const show = async (event: object, access: Access) => {
    vi.mocked(getEventsAccess).mockResolvedValue(access);
    vi.mocked(getVisibleEvent).mockResolvedValue(event as never);
    return detailPage();
  };

  describe('for somebody who only proposes', () => {
    it('asks for their own events as well as the published ones', async () => {
      await show(draft, asProposer);
      expect(getVisibleEvent).toHaveBeenCalledWith('evt1', {
        includeDrafts: false,
        ownLogin: 'alice',
      });
    });

    it('explains, instead of an edit button, why their own published event cannot be changed', async () => {
      const html = await show(storedEvent, asProposer);

      expect(html).toContain('detail.review.lockedTitle');
      expect(html).toContain('detail.review.lockedBody');
      expect(html).not.toContain('/events/evt1/edit');
      expect(html).not.toContain('detail.delete.button');
      expect(html).not.toContain('detail.backToDraft');
      expect(html).not.toContain('detail.review.propose');
      expect(html).not.toContain('detail.review.withdraw');
    });

    it("says nothing about it on somebody else's published event: it is just read", async () => {
      const html = await show({ ...storedEvent, authorLogin: 'carol' }, asProposer);
      expect(html).not.toContain('detail.review.lockedTitle');
      expect(html).not.toContain('/events/evt1/edit');
    });

    it('offers their own draft to be edited, deleted and proposed', async () => {
      const html = await show(draft, asProposer);

      expect(html).toContain('/events/evt1/edit');
      expect(html).toContain('detail.delete.button');
      expect(html).toContain('detail.review.propose');
      expect(html).not.toContain('detail.review.withdraw');
      expect(html).not.toContain('detail.review.lockedTitle');
      // Publishing is for a validator.
      expect(html).not.toContain('detail.confirm');
      expect(html).not.toContain('detail.review.approve');
    });

    it('offers their own proposal to be edited or withdrawn, and says it waits', async () => {
      const html = await show(proposed, asProposer);

      expect(html).toContain('detail.review.proposedTitle');
      expect(html).toContain('detail.review.proposedAuthor');
      expect(html).toContain('/events/evt1/edit');
      expect(html).toContain('detail.review.withdraw');
      expect(html).not.toContain('detail.review.propose"');
      expect(html).not.toContain('detail.review.approve');
      expect(html).not.toContain('detail.review.refuse');
    });

    it('shows the comment of a refusal to the author, and what to do next', async () => {
      const html = await show({ ...draft, ...refused }, asProposer);

      expect(html).toContain('detail.review.refusedTitle');
      expect(html).toContain('Pas ce jour-là, la salle est prise.');
      expect(html).toContain('detail.review.refusedHintAuthor');
      expect(html).toContain('detail.review.propose');
      expect(html).toContain('/events/evt1/edit');
    });

    it('never shows a refusal on an event that is no longer a draft', async () => {
      const html = await show({ ...proposed, ...refused }, asProposer);
      expect(html).not.toContain('Pas ce jour-là');
    });

    it('edits a series as a whole: the edit link carries no date, and the delete is the plain one', async () => {
      const html = await show({ ...series, status: 'DRAFT' }, asProposer);

      expect(html).toContain('href="/events/evt1/edit"');
      expect(html).not.toMatch(/edit\?occ=/);
      expect(html).toContain('detail.delete.button');
      expect(html).not.toContain('scope.delete.button');
    });
  });

  describe('for a validator', () => {
    it('answers a proposal with approve and refuse, and says who proposed it', async () => {
      const html = await show(proposed, asValidator);

      expect(html).toContain('detail.review.proposedValidator');
      expect(html).toContain('detail.review.approve');
      expect(html).toContain('detail.review.refuse');
      // A proposal is answered, not toggled.
      expect(html).not.toContain('detail.backToDraft');
      expect(html).not.toContain('detail.confirm"');
      // They edit freely.
      expect(html).toContain('/events/evt1/edit');
      expect(html).toContain('detail.delete.button');
      // Only the author proposes or withdraws.
      expect(html).not.toContain('detail.review.withdraw');
    });

    it('shows a refusal, with the hint for validators, and can still confirm the draft', async () => {
      const html = await show({ ...draft, ...refused }, asValidator);

      expect(html).toContain('Pas ce jour-là, la salle est prise.');
      expect(html).toContain('detail.review.refusedHintValidator');
      expect(html).toContain('detail.confirm');
      expect(html).not.toContain('detail.review.refuse"');
    });

    it('sees a proposal that a plain member or a proposer who is not its author would not', async () => {
      await show(proposed, asValidator);
      expect(getVisibleEvent).toHaveBeenCalledWith('evt1', { includeDrafts: true });
    });
  });

  describe('for a plain member', () => {
    it('sees a published event with no control and no review banner', async () => {
      const html = await show(storedEvent, asMember);
      expect(html).not.toContain('detail.review');
    });
  });
});

describe('/events/review', () => {
  const proposal = {
    ...storedEvent,
    id: 'p1',
    title: 'Tournoi de babyfoot',
    status: 'PROPOSED' as const,
    proposedAt: new Date('2099-01-02T10:00:00Z'),
    createdAt: new Date('2099-01-01T10:00:00Z'),
    author: { fullName: 'Alice A' },
  };
  const reviewPage = () => renderPage(ReviewPage({ searchParams: Promise.resolve({}) }));

  it.each([
    ['no access', null],
    ['a plain member', asMember],
    ['somebody who only proposes', asProposer],
    ['somebody who only manages the shared calendar', asCalendarManager],
  ])('is a 404 for %s, and nothing is read', async (_label, access) => {
    vi.mocked(getEventsAccess).mockResolvedValue(access);
    await expect(reviewPage()).rejects.toThrow(NotFoundSignal);
    expect(listProposals).not.toHaveBeenCalled();
  });

  it('lists the proposals for a validator, each with who proposed it and its two answers', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(listProposals).mockResolvedValue([
      proposal,
      { ...proposal, id: 'p2', title: 'Soirée' },
    ] as never);
    const html = await reviewPage();

    expect(html).toContain('review.title');
    expect(html).toContain('Tournoi de babyfoot');
    expect(html).toContain('href="/events/p1"');
    expect(html).toContain('href="/events/p2"');
    expect(html).toContain('review.proposedBy');
    expect(html).toContain('Alice A');
    expect(html.match(/detail\.review\.approve/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/detail\.review\.refuse"?/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('opens a series on its first date and says how it repeats', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(listProposals).mockResolvedValue([
      { ...proposal, ...series, id: 'p3', author: null },
    ] as never);
    const html = await reviewPage();

    expect(html).toMatch(/href="\/events\/p3\?occ=\d+"/);
    // the sentence of the platform (the translator of the test only echoes the keys of the sentence)
    expect(html).toContain('weekly');
    // The author's account is gone: the login is what is left.
    expect(html).toContain('alice');
  });

  it('shows a designed empty state when nothing waits', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(listProposals).mockResolvedValue([]);
    const html = await reviewPage();
    expect(html).toContain('review.emptyTitle');
    expect(html).toContain('review.emptyDescription');
  });
});

describe('/events/new and /events/[id]/edit in the proposal circuit', () => {
  const edit = () =>
    renderPage(
      EditEventPage({ params: Promise.resolve({ id: 'evt1' }), searchParams: Promise.resolve({}) }),
    );

  it('offers somebody who only proposes draft and proposed, starting on a proposal', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    const html = await renderPage(newEventPage());

    expect(html).toContain('<option value="PROPOSED" selected="">');
    expect(html).toContain('<option value="DRAFT"');
    expect(html).not.toContain('<option value="CONFIRMED"');
  });

  it('offers a validator draft and confirmed, starting on a draft', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    const html = await renderPage(newEventPage());

    expect(html).toContain('<option value="CONFIRMED"');
    expect(html).not.toContain('<option value="PROPOSED"');
  });

  it('opens the edit form on their own draft for a proposer', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    vi.mocked(getVisibleEvent).mockResolvedValue({ ...storedEvent, status: 'DRAFT' } as never);
    const html = await edit();

    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', {
      includeDrafts: false,
      ownLogin: 'alice',
    });
    expect(html).toContain('value="Soirée de rentrée"');
    expect(html).not.toContain('<option value="CONFIRMED"');
  });

  it('sends a proposer back to the event, which explains, when it is published', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    vi.mocked(getVisibleEvent).mockResolvedValue(storedEvent as never);
    await expect(edit()).rejects.toThrow(new RedirectSignal('/events/evt1'));
  });

  it("sends a proposer back from somebody else's event", async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asProposer);
    vi.mocked(getVisibleEvent).mockResolvedValue({
      ...storedEvent,
      status: 'DRAFT',
      authorLogin: 'carol',
    } as never);
    await expect(edit()).rejects.toThrow(new RedirectSignal('/events/evt1'));
  });

  it('lets a validator edit a published event, and offers it to be confirmed only if it is not', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(asValidator);
    vi.mocked(getVisibleEvent).mockResolvedValue({ ...storedEvent, status: 'PROPOSED' } as never);
    const html = await edit();
    // A proposal can be kept as it is or approved, not sent back without a comment.
    expect(html).toContain('<option value="PROPOSED"');
    expect(html).toContain('<option value="CONFIRMED"');
    expect(html).not.toContain('<option value="DRAFT"');
  });
});

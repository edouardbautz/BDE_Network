import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';
import { buildMonthGrid, groupByLocalDay } from '@/lib/events/calendar';
import type { CategoryView } from '@/lib/events/categories';
import type { OccurrenceView } from '@/lib/events/occurrences';
import { parseEventsQuery } from '@/lib/events/search-params';

type Href = string | { pathname: string; query?: Record<string, string | number> };

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'fr'),
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  ),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    prefetch,
    ...rest
  }: {
    href: Href;
    children?: ReactNode;
    prefetch?: boolean;
  }) => {
    const target =
      typeof href === 'string'
        ? href
        : `${href.pathname}?${new URLSearchParams(
            Object.entries(href.query ?? {}).map(([k, v]) => [k, String(v)]),
          ).toString()}`;
    return (
      <a href={target} data-prefetch={String(prefetch)} {...rest}>
        {children}
      </a>
    );
  },
}));

const { MonthCalendar } = await import('./month-calendar');
const { EventList } = await import('./event-list');

const PARIS = 'Europe/Paris';
const categories: CategoryView[] = [
  { key: 'soiree', label: 'Soirée', color: '#db2777' },
  { key: 'sport', label: 'Sport', color: '#16a34a' },
];

let counter = 0;
function occurrence(
  overrides: Omit<Partial<OccurrenceView>, 'start' | 'end'> & { start: string; end: string },
) {
  counter += 1;
  const { start, end, ...rest } = overrides;
  return {
    key: `evt${counter}:${Date.parse(start)}`,
    eventId: `evt${counter}`,
    seriesKey: `evt${counter}`,
    originalStart: new Date(start),
    edited: false,
    title: `Event ${counter}`,
    description: null,
    location: null,
    categoryKey: 'soiree',
    status: 'CONFIRMED',
    isRecurring: false,
    schoolYear: '2026-2027',
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    assignees: [],
    ...rest,
    start: new Date(start),
    end: new Date(end),
  } satisfies OccurrenceView;
}

const month = { year: 2026, month: 10 };
const query = parseEventsQuery(
  { category: 'sport' },
  {
    now: new Date('2026-10-15T10:00:00Z'),
    timeZone: PARIS,
    categoryKeys: ['soiree', 'sport'],
    schoolYears: [],
    assigneeLogins: [],
  },
);

async function renderCalendar(
  occurrences: OccurrenceView[],
  selectedKey = '2026-10-10',
  canCreate = false,
) {
  return renderToHtml(
    <MonthCalendar
      grid={buildMonthGrid(month)}
      month={month}
      groups={groupByLocalDay(occurrences, PARIS)}
      categories={categories}
      timeZone={PARIS}
      todayKey="2026-10-15"
      selectedKey={selectedKey}
      query={query}
      canCreate={canCreate}
    />,
  );
}

beforeEach(() => {
  counter = 0;
});

describe('MonthCalendar', () => {
  it('renders a Monday-first grid of full weeks with a day link in every cell', async () => {
    const html = await renderCalendar([]);
    expect(html.match(/<th /g)).toHaveLength(7);
    expect(html.match(/<td /g)).toHaveLength(35);
    expect(html.indexOf('lun.')).toBeLessThan(html.indexOf('dim.'));
    expect(html).toContain('aria-current="date"'); // today
  });

  it('shows coloured chips from md up and coloured dots below it', async () => {
    const html = await renderCalendar([
      occurrence({ start: '2026-10-10T18:00:00Z', end: '2026-10-10T20:00:00Z', title: 'Tournoi' }),
    ]);
    // desktop chip, hidden on small screens, tinted with the category colour
    expect(html).toContain('Tournoi');
    expect(html).toMatch(/<ul class="hidden[^"]*md:flex"/);
    expect(html).toContain('#db2777');
    // mobile dot, hidden from md up
    expect(html).toMatch(
      /<div class="[^"]*md:hidden" aria-hidden="true"><span class="[^"]*size-1\.5/,
    );
  });

  it('makes every chip a target of 24 px at least, and never fades the chip of an event that is not confirmed', async () => {
    const html = await renderCalendar([
      occurrence({
        start: '2026-10-10T18:00:00Z',
        end: '2026-10-10T20:00:00Z',
        title: 'Confirmed',
      }),
      occurrence({
        start: '2026-10-10T19:00:00Z',
        end: '2026-10-10T20:00:00Z',
        title: 'Waiting',
        status: 'PROPOSED',
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        occurrence({ start: '2026-10-11T1' + i + ':00:00Z', end: '2026-10-11T2' + i + ':00:00Z' }),
      ),
    ]);
    const page = new DOMParser().parseFromString(html, 'text/html');

    const chips = [...page.querySelectorAll('ul a[title]')];
    expect(chips.length).toBeGreaterThan(2);
    // min-h-6 is 1.5rem: the height the guideline asks for (the width of a chip is the width of its day).
    for (const chip of chips)
      expect(chip.className, chip.getAttribute('title') ?? '').toContain('min-h-6');
    // The link that opens the rest of a busy day is a target too.
    const more = [...page.querySelectorAll('ul a')].find((link) => !link.hasAttribute('title'));
    expect(more?.className).toContain('min-h-6');

    const waiting = chips.find((chip) => chip.getAttribute('title')?.startsWith('Waiting'));
    expect(waiting?.className).toContain('border-dashed');
    expect(waiting?.className).toContain('italic');
    // An opacity would lower the contrast of the time and the title below what is readable.
    for (const chip of chips) expect(chip.className).not.toMatch(/opacity-/);
  });

  it('does not ask the server for the page of every event of the month: a chip is not prefetched', async () => {
    const html = await renderCalendar(
      Array.from({ length: 6 }, (_, i) =>
        occurrence({
          start: `2026-10-0${i + 1}T18:00:00Z`,
          end: `2026-10-0${i + 1}T20:00:00Z`,
        }),
      ),
    );
    const page = new DOMParser().parseFromString(html, 'text/html');
    const chips = [...page.querySelectorAll('ul a[title]')];
    expect(chips).toHaveLength(6);
    for (const chip of chips) expect(chip.getAttribute('data-prefetch')).toBe('false');
  });

  it('caps the chips of a busy day at three and offers the rest through the day link', async () => {
    const busy = Array.from({ length: 5 }, (_, i) =>
      occurrence({
        start: `2026-10-10T${String(8 + i).padStart(2, '0')}:00:00Z`,
        end: `2026-10-10T${String(9 + i).padStart(2, '0')}:00:00Z`,
        title: `Busy ${i + 1}`,
      }),
    );
    const html = await renderCalendar(busy, '2026-10-12');
    const chipSection = html.slice(html.indexOf('<td'), html.length);
    expect(chipSection).toContain('Busy 3');
    expect(chipSection).not.toMatch(
      /<a [^>]*>[^<]*<span[^>]*>[^<]*<\/span><span class="truncate">Busy 4/,
    );
    expect(html).toContain('calendar.more{&quot;count&quot;:2}');
  });

  it('marks drafts distinctly', async () => {
    const html = await renderCalendar([
      occurrence({
        start: '2026-10-10T18:00:00Z',
        end: '2026-10-10T20:00:00Z',
        title: 'Secret',
        status: 'DRAFT',
      }),
    ]);
    expect(html).toMatch(/border-dashed[^"]*italic/);
  });

  it('lists the selected day under the grid for small screens, with an empty state otherwise', async () => {
    const withEvent = await renderCalendar(
      [
        occurrence({
          start: '2026-10-10T18:00:00Z',
          end: '2026-10-10T20:00:00Z',
          title: 'Tournoi',
        }),
      ],
      '2026-10-10',
    );
    expect(withEvent).toMatch(/<section class="md:hidden"[\s\S]*samedi 10 octobre[\s\S]*Tournoi/);

    const empty = await renderCalendar([], '2026-10-11');
    expect(empty).toContain('calendar.dayEmpty');
  });

  it('keeps the active filters in day links', async () => {
    const html = await renderCalendar([]);
    expect(html).toContain('category=sport');
    expect(html).toContain('day=2026-10-10');
    expect(html).toContain('view=calendar');
  });

  it('links a chip to the event detail page with the occurrence it shows', async () => {
    const start = '2026-10-10T18:00:00Z';
    const html = await renderCalendar([
      occurrence({ start, end: '2026-10-10T20:00:00Z', title: 'Tournoi' }),
    ]);
    expect(html).toContain(`/events/evt1?occ=${Date.parse(start)}`);
  });

  it('falls back to a neutral style for a category removed from the config', async () => {
    const html = await renderCalendar([
      occurrence({
        start: '2026-10-10T18:00:00Z',
        end: '2026-10-10T20:00:00Z',
        categoryKey: 'removed',
      }),
    ]);
    expect(html).toContain('border-muted-foreground/40');
  });
});

describe('MonthCalendar, adding an event on a day', () => {
  it('offers a "+" in every cell to whoever can create events, hidden until hover or focus', async () => {
    const html = await renderCalendar([], '2026-10-10', true);
    const links = html.match(/<a [^>]*href="\/events\/new\?date=[^"]*"[^>]*>/g) ?? [];
    // one per cell of the 35-cell grid, plus the button of the day panel
    expect(links).toHaveLength(36);
    expect(html).toContain('href="/events/new?date=2026-10-10"');
    expect(html).toContain('href="/events/new?date=2026-09-28"'); // a day of the month before, shown in the grid
    const cell = links.find((link) => link.includes('date=2026-10-20')) ?? '';
    expect(cell).toContain(
      'aria-label="calendar.addOnDay{&quot;date&quot;:&quot;mardi 20 octobre&quot;}"',
    );
    // desktop only (a phone has the button of the panel), revealed by hover and by keyboard focus, always on a touch screen
    expect(cell).toMatch(/class="[^"]*hidden[^"]*md:flex/);
    expect(cell).toContain('opacity-0');
    expect(cell).toContain('[td:hover_&amp;]:opacity-100');
    expect(cell).toContain('group-focus-within/cell:opacity-100');
    expect(cell).toContain('focus-visible:opacity-100');
    expect(cell).toContain('pointer-coarse:opacity-100');
    expect(cell).toContain('focus-visible:ring-3');
  });

  it('puts the "+" after the day link, so that the keyboard reaches the day first, then the "+", then its events', async () => {
    const html = await renderCalendar(
      [
        occurrence({
          start: '2026-10-20T16:00:00Z',
          end: '2026-10-20T18:00:00Z',
          title: 'Tournoi',
        }),
      ],
      '2026-10-10',
      true,
    );
    const cell = html.slice(html.indexOf('day=2026-10-20'));
    expect(cell.indexOf('date=2026-10-20')).toBeGreaterThan(-1);
    expect(cell.indexOf('date=2026-10-20')).toBeLessThan(cell.indexOf('Tournoi'));
  });

  it('adds an "add on this day" button to the panel of the selected day, for small screens', async () => {
    const html = await renderCalendar([], '2026-10-12', true);
    const panel = html.slice(html.indexOf('<section class="md:hidden"'));
    expect(panel).toContain('id="add-on-selected-day"');
    expect(panel).toContain('href="/events/new?date=2026-10-12"');
    expect(panel).toContain('calendar.addOnSelectedDay');
    // the heading stays a heading of its own
    expect(panel).toMatch(/<h2 id="selected-day-heading"[^>]*>lundi 12 octobre<\/h2>/);
  });

  it('shows nothing of it to whoever cannot create events', async () => {
    const html = await renderCalendar(
      [occurrence({ start: '2026-10-10T18:00:00Z', end: '2026-10-10T20:00:00Z' })],
      '2026-10-10',
      false,
    );
    expect(html).not.toContain('/events/new');
    expect(html).not.toContain('addOnDay');
    expect(html).not.toContain('addOnSelectedDay');
    expect(html).not.toContain('add-on-selected-day');
  });
});

describe('EventList', () => {
  it('groups occurrences under day headings in chronological order', async () => {
    const html = await renderToHtml(
      <EventList
        occurrences={[
          occurrence({
            start: '2026-10-10T18:00:00Z',
            end: '2026-10-10T20:00:00Z',
            title: 'Premier',
          }),
          occurrence({
            start: '2026-10-12T18:00:00Z',
            end: '2026-10-12T20:00:00Z',
            title: 'Second',
          }),
        ]}
        categories={categories}
        timeZone={PARIS}
      />,
    );
    expect(html.indexOf('samedi 10 octobre')).toBeLessThan(html.indexOf('lundi 12 octobre'));
    expect(html.indexOf('Premier')).toBeLessThan(html.indexOf('Second'));
    expect(html).toContain('20:00 – 22:00');
  });

  it('lists a multi-day event once, under its first day', async () => {
    const html = await renderToHtml(
      <EventList
        occurrences={[
          occurrence({ start: '2026-10-09T16:00:00Z', end: '2026-10-11T15:00:00Z', title: 'WEI' }),
        ]}
        categories={categories}
        timeZone={PARIS}
      />,
    );
    expect(html.match(/>WEI</g)).toHaveLength(1);
    expect(html).toContain('vendredi 9 octobre');
  });

  it('shows location, people in charge, the draft badge and the recurring icon', async () => {
    const html = await renderToHtml(
      <EventList
        occurrences={[
          occurrence({
            start: '2026-10-10T18:00:00Z',
            end: '2026-10-10T20:00:00Z',
            title: 'Séance',
            status: 'DRAFT',
            isRecurring: true,
            location: 'Gymnase',
            assignees: [{ login: 'alice', name: 'Alice A' }],
          }),
        ]}
        categories={categories}
        timeZone={PARIS}
      />,
    );
    expect(html).toContain('Gymnase');
    expect(html).toContain('Alice A');
    expect(html).toContain('status.DRAFT');
    expect(html).toContain('aria-label="recurring"');
  });
});

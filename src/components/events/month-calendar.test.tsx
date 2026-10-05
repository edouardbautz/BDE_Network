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
  Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode }) => {
    const target =
      typeof href === 'string'
        ? href
        : `${href.pathname}?${new URLSearchParams(
            Object.entries(href.query ?? {}).map(([k, v]) => [k, String(v)]),
          ).toString()}`;
    return (
      <a href={target} {...rest}>
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

async function renderCalendar(occurrences: OccurrenceView[], selectedKey = '2026-10-10') {
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

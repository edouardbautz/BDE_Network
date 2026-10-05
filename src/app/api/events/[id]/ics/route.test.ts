import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { name: 'BDE Test', timezone: 'Europe/Paris' },
    events: { categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }] },
  })),
}));
vi.mock('@/lib/events/access', () => ({ getEventsAccess: vi.fn() }));
vi.mock('@/lib/events/queries', () => ({ getVisibleEvent: vi.fn() }));

const { getEventsAccess } = await import('@/lib/events/access');
const { getVisibleEvent } = await import('@/lib/events/queries');
const { GET } = await import('./route');

const stored = {
  id: 'evt1',
  title: 'Soirée de rentrée',
  description: null,
  location: null,
  categoryKey: 'soiree',
  status: 'CONFIRMED' as const,
  startsAt: new Date('2026-10-10T18:00:00Z'),
  endsAt: new Date('2026-10-10T20:00:00Z'),
  recurrence: 'WEEKLY' as const,
  recurrenceUntil: new Date('2026-10-31T00:00:00Z'),
  schoolYear: '2026-2027',
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  assignees: [],
  cancellations: [{ occurrenceStart: new Date('2026-10-17T18:00:00Z') }],
};

const call = (query = '') =>
  GET(new Request(`http://localhost/api/events/evt1/ics${query}`), {
    params: Promise.resolve({ id: 'evt1' }),
  });

function access(canManage: boolean) {
  vi.mocked(getEventsAccess).mockResolvedValue({ canManage } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVisibleEvent).mockResolvedValue(stored as never);
});

describe('GET /api/events/[id]/ics', () => {
  it('is a 404 without access (not signed in, module disabled, pending)', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(getVisibleEvent).not.toHaveBeenCalled();
  });

  it('is a 404 when the event is not visible to the user (e.g. a draft)', async () => {
    access(false);
    vi.mocked(getVisibleEvent).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(getVisibleEvent).toHaveBeenCalledWith('evt1', false);
  });

  it('exports every non-cancelled occurrence of a series as a download', async () => {
    access(false);
    const response = await call();
    const body = await response.text();

    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="soiree-de-rentree.ics"',
    );
    // 10, 17 and 24 Oct, minus the cancelled 17th
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).not.toContain('DTSTART:20261017T180000Z');
  });

  it('exports a single occurrence with ?occ=', async () => {
    access(false);
    const second = new Date('2026-10-24T18:00:00Z').getTime();
    const body = await (await call(`?occ=${second}`)).text();
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body).toContain('DTSTART:20261024T180000Z');
  });

  it('is a 404 for an occurrence that does not exist or was cancelled', async () => {
    access(false);
    expect((await call(`?occ=${new Date('2026-10-17T18:00:00Z').getTime()}`)).status).toBe(404);
    expect((await call('?occ=12345')).status).toBe(404);
  });
});

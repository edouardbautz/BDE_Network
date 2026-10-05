import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/events/export', () => ({ buildBdeSubscriptionFeed: vi.fn() }));

const { buildBdeSubscriptionFeed } = await import('@/lib/events/export');
const { GET } = await import('./route');

const call = (token: string) =>
  GET(new Request(`http://localhost/api/calendar/bde/${token}`), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/calendar/bde/[token]', () => {
  it('serves the feed as uncached, private text/calendar', async () => {
    vi.mocked(buildBdeSubscriptionFeed).mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const response = await call('tok');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('accepts the link with a .ics suffix', async () => {
    vi.mocked(buildBdeSubscriptionFeed).mockResolvedValue('x');
    await call('tok.ics');
    expect(buildBdeSubscriptionFeed).toHaveBeenCalledWith('tok');
  });

  it('answers a bare 404 for an unknown, regenerated or disabled link', async () => {
    vi.mocked(buildBdeSubscriptionFeed).mockResolvedValue(null);
    const response = await call('tok');

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('Not found');
  });
});

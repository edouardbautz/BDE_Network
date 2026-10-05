import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/events/export', () => ({ buildSubscriptionFeed: vi.fn() }));

const { buildSubscriptionFeed } = await import('@/lib/events/export');
const { GET } = await import('./route');

const call = (token: string) =>
  GET(new Request(`http://localhost/api/calendar/${token}`), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/calendar/[token]', () => {
  it('serves the feed as text/calendar, uncached and private', async () => {
    vi.mocked(buildSubscriptionFeed).mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const response = await call('tok');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    await expect(response.text()).resolves.toContain('BEGIN:VCALENDAR');
  });

  it('accepts the link with a .ics suffix', async () => {
    vi.mocked(buildSubscriptionFeed).mockResolvedValue('x');
    await call('tok.ics');
    expect(buildSubscriptionFeed).toHaveBeenCalledWith('tok');
  });

  it('answers a bare 404 whatever the reason the feed is unavailable', async () => {
    vi.mocked(buildSubscriptionFeed).mockResolvedValue(null);
    const response = await call('tok');

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('Not found');
  });
});

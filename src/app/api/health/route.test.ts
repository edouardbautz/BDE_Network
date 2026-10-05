import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/health', () => ({ isDatabaseReachable: vi.fn() }));

const { isDatabaseReachable } = await import('@/lib/health');
const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/health', () => {
  it('answers 200 when the database is reachable', async () => {
    vi.mocked(isDatabaseReachable).mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 503 when it is not, and says nothing more', async () => {
    vi.mocked(isDatabaseReachable).mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
  });
});

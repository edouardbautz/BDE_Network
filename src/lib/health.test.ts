import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

const { prisma } = await import('@/lib/prisma');
const { isDatabaseReachable } = await import('./health');

const query = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isDatabaseReachable', () => {
  it('is true when the database answers', async () => {
    query.mockResolvedValue([{ '?column?': 1 }] as never);

    await expect(isDatabaseReachable()).resolves.toBe(true);
  });

  it('is false, without throwing, when the connection fails', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(isDatabaseReachable()).resolves.toBe(false);
  });

  it('is false when the database does not answer in time', async () => {
    query.mockReturnValue(new Promise(() => {}) as never);

    const result = isDatabaseReachable(3000);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBe(false);
  });

  it('leaves no timer behind once the database answered', async () => {
    query.mockResolvedValue([] as never);

    await isDatabaseReachable();

    expect(vi.getTimerCount()).toBe(0);
  });
});

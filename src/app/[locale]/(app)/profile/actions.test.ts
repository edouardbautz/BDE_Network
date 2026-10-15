import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));
vi.mock('@/lib/events/access', () => ({ getEventsAccess: vi.fn() }));
vi.mock('@/lib/events/export', () => ({ regenerateCalendarToken: vi.fn() }));

const { getEventsAccess } = await import('@/lib/events/access');
const { regenerateCalendarToken } = await import('@/lib/events/export');
const { revalidatePath } = await import('next/cache');
const { regenerateMyCalendarToken } = await import('./actions');

beforeEach(() => vi.clearAllMocks());

describe('regenerateMyCalendarToken', () => {
  it('is refused without access to the events module, and changes nothing', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue(null);
    await expect(regenerateMyCalendarToken()).rejects.toThrow('Forbidden');
    expect(regenerateCalendarToken).not.toHaveBeenCalled();
  });

  it('replaces the token of the account that asks, then answers the address of the profile to load', async () => {
    vi.mocked(getEventsAccess).mockResolvedValue({
      session: { user: { id: 'u1' } },
    } as unknown as Awaited<ReturnType<typeof getEventsAccess>>);

    await expect(regenerateMyCalendarToken()).resolves.toEqual({ href: '/fr/profile' });
    expect(regenerateCalendarToken).toHaveBeenCalledWith('u1');
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });
});

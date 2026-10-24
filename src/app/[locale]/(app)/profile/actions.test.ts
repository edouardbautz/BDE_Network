import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));
vi.mock('@/lib/events/access', () => ({
  getEventsAccess: vi.fn(),
  isEventsModuleEnabled: vi.fn(() => true),
}));
vi.mock('@/lib/events/intra-config', () => ({ intraPublicationEnabled: vi.fn(() => true) }));
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { update: vi.fn() } } }));
vi.mock('@/lib/events/export', () => ({ regenerateCalendarToken: vi.fn() }));

const { getEventsAccess } = await import('@/lib/events/access');
const { regenerateCalendarToken } = await import('@/lib/events/export');
const { revalidatePath } = await import('next/cache');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { isEventsModuleEnabled } = await import('@/lib/events/access');
const { intraPublicationEnabled } = await import('@/lib/events/intra-config');
const { prisma } = await import('@/lib/prisma');
const { regenerateMyCalendarToken, saveMentionIds } = await import('./actions');

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

describe('saveMentionIds', () => {
  const signedInAs = (status: string, id: string | undefined = 'u1') =>
    vi.mocked(getEffectiveSession).mockResolvedValue({
      user: { id, status },
    } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
  const form = (discordUserId: string, slackUserId: string) => {
    const data = new FormData();
    data.append('discordUserId', discordUserId);
    data.append('slackUserId', slackUserId);
    return data;
  };

  beforeEach(() => {
    vi.mocked(isEventsModuleEnabled).mockReturnValue(true);
    vi.mocked(intraPublicationEnabled).mockReturnValue(true);
  });

  it.each([
    ['nobody signed in', null],
    ['an account waiting for approval', 'PENDING'],
  ])('is refused to %s, and writes nothing', async (_who, status) => {
    if (status === null) vi.mocked(getEffectiveSession).mockResolvedValue(null);
    else signedInAs(status);
    await expect(saveMentionIds({}, form('348291047563210241', ''))).rejects.toThrow('Forbidden');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is refused for a session without an account id (a query keyed on undefined would match everybody)', async () => {
    signedInAs('MEMBER', '');
    await expect(saveMentionIds({}, form('348291047563210241', ''))).rejects.toThrow('Forbidden');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is refused while the platform does not publish on the intra, or has no events module', async () => {
    signedInAs('MEMBER');
    vi.mocked(intraPublicationEnabled).mockReturnValue(false);
    await expect(saveMentionIds({}, form('348291047563210241', ''))).rejects.toThrow('Forbidden');
    vi.mocked(intraPublicationEnabled).mockReturnValue(true);
    vi.mocked(isEventsModuleEnabled).mockReturnValue(false);
    await expect(saveMentionIds({}, form('348291047563210241', ''))).rejects.toThrow('Forbidden');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('saves the ids of the account that asks, normalised, and says what it kept', async () => {
    signedInAs('MEMBER');
    const state = await saveMentionIds({}, form('<@348291047563210241>', 'u04abcd1234'));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { discordUserId: '348291047563210241', slackUserId: 'U04ABCD1234' },
    });
    expect(state).toEqual({
      saved: true,
      values: { discordUserId: '348291047563210241', slackUserId: 'U04ABCD1234' },
    });
  });

  it('removes an id that is left blank', async () => {
    signedInAs('OWNER');
    await saveMentionIds({}, form('', ''));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { discordUserId: null, slackUserId: null },
    });
  });

  it('refuses what is not an id, keeps what was typed, and writes nothing', async () => {
    signedInAs('MEMBER');
    const state = await saveMentionIds({}, form('@everyone', 'U04ABCD1234'));
    expect(state).toEqual({
      errors: { discordUserId: 'invalid' },
      values: { discordUserId: '@everyone', slackUserId: 'U04ABCD1234' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('never takes the account from the request', async () => {
    signedInAs('MEMBER');
    const data = form('348291047563210241', '');
    data.append('id', 'somebody-else');
    data.append('userId', 'somebody-else');
    await saveMentionIds({}, data);
    expect(vi.mocked(prisma.user.update).mock.calls[0]?.[0].where).toEqual({ id: 'u1' });
  });
});

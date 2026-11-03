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
vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { update: vi.fn() },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
  };
  return { prisma };
});
vi.mock('@/lib/events/export', () => ({ regenerateCalendarToken: vi.fn() }));

const { getEventsAccess } = await import('@/lib/events/access');
const { regenerateCalendarToken } = await import('@/lib/events/export');
const { revalidatePath } = await import('next/cache');
const { getEffectiveSession } = await import('@/lib/auth/session');
const { logAuditEvent } = await import('@/lib/audit-log');
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
  type Ask = Array<'discord' | 'slack'>;
  const signedInAs = (
    status: string,
    options: { id?: string; required?: Ask; discord?: string | null; slack?: string | null } = {},
  ) =>
    vi.mocked(getEffectiveSession).mockResolvedValue({
      user: {
        id: options.id ?? 'u1',
        login: 'camille',
        status,
        discordUserId: options.discord ?? null,
        slackUserId: options.slack ?? null,
      },
      requiredIds: options.required ?? ['discord', 'slack'],
    } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
  const form = (discordUserId: string | null, slackUserId: string | null) => {
    const data = new FormData();
    if (discordUserId !== null) data.append('discordUserId', discordUserId);
    if (slackUserId !== null) data.append('slackUserId', slackUserId);
    return data;
  };
  const written = () => vi.mocked(prisma.user.update).mock.calls[0]?.[0];

  it('is refused to nobody signed in, and to a session without an account id (a query keyed on undefined would match everybody)', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(null);
    await expect(saveMentionIds({}, form('348291047563210241', null))).rejects.toThrow('Forbidden');
    signedInAs('MEMBER', { id: '' });
    await expect(saveMentionIds({}, form('348291047563210241', null))).rejects.toThrow('Forbidden');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'MEMBER', 'OWNER'])(
    'is open to any signed-in account, %s included: it is the way out of a session that holds nothing until an id is given',
    async (status) => {
      signedInAs(status, { required: ['discord'] });
      await expect(saveMentionIds({}, form('348291047563210241', null))).resolves.toMatchObject({
        saved: true,
      });
    },
  );

  it('saves the ids asked, of the account that asks, normalised, and says what it kept', async () => {
    signedInAs('MEMBER');
    const state = await saveMentionIds({}, form('<@348291047563210241>', 'u04abcd1234'));
    expect(written()).toEqual({
      where: { id: 'u1' },
      data: { discordUserId: '348291047563210241', slackUserId: 'U04ABCD1234' },
    });
    expect(state).toEqual({
      saved: true,
      values: { discordUserId: '348291047563210241', slackUserId: 'U04ABCD1234' },
    });
  });

  it.each([
    ['blank', ''],
    ['spaces', '   '],
  ])(
    'refuses an id that is asked and left %s: the id is required, nothing is written',
    async (_label, blank) => {
      signedInAs('MEMBER', { required: ['discord', 'slack'] });
      const state = await saveMentionIds({}, form('348291047563210241', blank));
      expect(state).toMatchObject({ errors: { slackUserId: 'required' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('refuses an id that is asked and that the request leaves out altogether (a crafted request cannot skip the field)', async () => {
    signedInAs('MEMBER', { required: ['discord', 'slack'] });
    const state = await saveMentionIds({}, form('348291047563210241', null));
    expect(state).toMatchObject({ errors: { slackUserId: 'required' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('never erases an id that is not asked: a platform the BDE does not use is left as it was', async () => {
    signedInAs('MEMBER', { required: ['discord'], slack: 'U04ABCD1234' });
    await saveMentionIds({}, form('348291047563210241', ''));
    expect(written()?.data).toEqual({ discordUserId: '348291047563210241' });
  });

  it('writes nothing for a platform that is not asked, whatever the request holds', async () => {
    signedInAs('MEMBER', { required: ['discord'] });
    await saveMentionIds({}, form('348291047563210241', 'U04ABCD1234'));
    expect(written()?.data).toEqual({ discordUserId: '348291047563210241' });
  });

  it.each(['@everyone', '@here', '<@&123456789012345678>', 'camille', '<!channel>'])(
    'refuses %s, keeps what was typed, and writes nothing',
    async (typed) => {
      signedInAs('MEMBER');
      const state = await saveMentionIds({}, form(typed, 'U04ABCD1234'));
      expect(state).toEqual({
        errors: { discordUserId: 'invalid' },
        values: { discordUserId: typed, slackUserId: 'U04ABCD1234' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('never takes the account from the request', async () => {
    signedInAs('MEMBER', { required: ['discord'] });
    const data = form('348291047563210241', null);
    data.append('id', 'somebody-else');
    data.append('userId', 'somebody-else');
    await saveMentionIds({}, data);
    expect(written()?.where).toEqual({ id: 'u1' });
  });

  it('writes an audit entry with the platforms that changed, never the ids', async () => {
    signedInAs('MEMBER', { required: ['discord', 'slack'], discord: '348291047563210241' });
    await saveMentionIds({}, form('348291047563210241', 'U04ABCD1234'));
    expect(logAuditEvent).toHaveBeenCalledOnce();
    const [entry] = vi.mocked(logAuditEvent).mock.calls[0]!;
    expect(entry).toMatchObject({
      actorLogin: 'camille',
      action: 'profile.mention_ids',
      targetType: 'User',
      targetId: 'u1',
      metadata: { changed: ['slack'] },
    });
    expect(JSON.stringify(entry)).not.toContain('U04ABCD1234');
    expect(JSON.stringify(entry)).not.toContain('348291047563210241');
  });

  it('writes no audit entry when nothing changed', async () => {
    signedInAs('MEMBER', { required: ['discord'], discord: '348291047563210241' });
    await saveMentionIds({}, form('348291047563210241', null));
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

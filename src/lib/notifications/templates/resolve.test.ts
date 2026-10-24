import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ audience: vi.fn() }));
vi.mock('@/lib/events/intra-audience', () => ({ staffAudience: mocks.audience }));

vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({ bde: { name: 'BDE Nice', defaultLocale: 'en' } })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationTemplate: { findMany: vi.fn(), update: vi.fn() },
    notificationMention: { findMany: vi.fn() },
  },
}));

const { prisma } = await import('@/lib/prisma');
const { templatesFor } = await import('./resolve');

const row = (scope: string, content: unknown, over: Record<string, unknown> = {}) => ({
  type: 'eventConfirmed',
  scope,
  content,
  version: 1,
  basedOnRevision: 1,
  updatedAt: new Date(),
  updatedByLogin: 'paula',
  lastFallbackAt: null,
  lastFallbackReason: null,
  ...over,
});

const given = (rows: unknown[], mentions: unknown[] = []) => {
  vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue(rows as never);
  vi.mocked(prisma.notificationMention.findMany).mockResolvedValue(mentions as never);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(prisma.notificationTemplate.update).mockResolvedValue({} as never);
});

describe('templatesFor', () => {
  it('gives the platform’s own when the BDE wrote nothing: no template, the name and the language of the BDE', async () => {
    given([]);
    const templates = await templatesFor('eventConfirmed');
    for (const channel of ['discord', 'slack', 'email'] as const) {
      expect(templates.context(channel)).toEqual({
        bdeName: 'BDE Nice',
        locale: 'en',
        mentions: {},
      });
    }
  });

  it('gives every channel the template written for all of them', async () => {
    given([row('all', { title: 'Hello {title}' })]);
    const templates = await templatesFor('eventConfirmed');
    expect(templates.context('discord').template).toEqual({ title: 'Hello {title}' });
    expect(templates.context('slack').template).toEqual({ title: 'Hello {title}' });
    expect(templates.context('email').template).toEqual({ title: 'Hello {title}' });
  });

  it('lets a channel’s own template win over the shared one, field by field, and keeps the rest of the shared one', async () => {
    given([
      row('all', {
        title: 'Shared',
        footer: 'Shared footer',
        button: { label: 'Go', enabled: true },
      }),
      row('slack', { title: 'Slack only', button: { label: 'Open' } }),
    ]);
    const templates = await templatesFor('eventConfirmed');
    expect(templates.context('slack').template).toEqual({
      title: 'Slack only',
      footer: 'Shared footer',
      button: { label: 'Open', enabled: true },
    });
    expect(templates.context('discord').template?.title).toBe('Shared');
  });

  it('does not apply the shared template to the e-mail of an approved member, which speaks to that person', async () => {
    vi.mocked(prisma.notificationTemplate.findMany).mockResolvedValue([
      row('all', { footer: 'Team footer' }, { type: 'memberApproved' }),
    ] as never);
    vi.mocked(prisma.notificationMention.findMany).mockResolvedValue([] as never);
    const templates = await templatesFor('memberApproved');
    expect(templates.context('discord').template?.footer).toBe('Team footer');
    expect(templates.context('slack').template?.footer).toBe('Team footer');
    expect(templates.context('email').template).toBeUndefined();
  });

  it('gives the builders the directory of mentions, by the names the templates use', async () => {
    given(
      [row('discord', { above: '{@role:bureau} news' })],
      [
        {
          id: '1',
          key: 'bureau',
          platform: 'discord',
          kind: 'role',
          label: 'Bureau',
          externalId: '123456789012345678',
          createdByLogin: 'paula',
          createdAt: new Date(),
        },
      ],
    );
    const templates = await templatesFor('eventConfirmed');
    expect(templates.context('discord').mentions).toEqual({
      'discord:bureau': {
        platform: 'discord',
        kind: 'role',
        label: 'Bureau',
        externalId: '123456789012345678',
      },
    });
    expect(templates.context('discord').template?.above).toBe('{@role:bureau} news');
  });

  it('sends the platform’s own when the template is no longer valid, tells the editor, and logs it', async () => {
    given([row('all', { title: '{title} {a_variable_nobody_has}' })]);
    const templates = await templatesFor('eventConfirmed');
    for (const channel of ['discord', 'slack', 'email'] as const) {
      expect(templates.context(channel).template).toBeUndefined();
    }
    expect(console.error).toHaveBeenCalled();
    expect(prisma.notificationTemplate.update).toHaveBeenCalledWith({
      where: { type_scope: { type: 'eventConfirmed', scope: 'all' } },
      data: expect.objectContaining({ lastFallbackReason: 'title:unknownVariable' }),
    });
  });

  it('does not repeat the notice to the editor on every send of the same fault', async () => {
    given([
      row(
        'all',
        { title: '{nope}' },
        { lastFallbackAt: new Date(), lastFallbackReason: 'title:unknownVariable' },
      ),
    ]);
    await templatesFor('eventConfirmed');
    expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
  });

  it('sends the platform’s own when a mention’s name was deleted from the directory', async () => {
    given([row('discord', { above: '{@role:gone} hi' })], []);
    const templates = await templatesFor('eventConfirmed');
    expect(templates.context('discord').template).toBeUndefined();
    expect(templates.context('slack').template).toBeUndefined();
  });

  it('sends the platform’s own when a channel’s template is valid but the shared one is not', async () => {
    given([row('all', { title: '{nope}' }), row('slack', { footer: 'Slack footer' })]);
    const templates = await templatesFor('eventConfirmed');
    // slack's own would be valid alone, but it was written over the shared one: nothing is half applied
    expect(templates.context('slack').template).toBeUndefined();
  });

  it('sends the platform’s own, and logs it, when the templates cannot be read', async () => {
    vi.mocked(prisma.notificationTemplate.findMany).mockRejectedValue(new Error('db down'));
    const templates = await templatesFor('eventConfirmed');
    expect(templates.context('discord')).toEqual({
      bdeName: 'BDE Nice',
      locale: 'en',
      mentions: {},
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('build', () => {
  it('builds with the template', async () => {
    given([row('all', { title: 'T' })]);
    const templates = await templatesFor('eventConfirmed');
    expect(templates.build('discord', (context) => context.template?.title)).toBe('T');
  });

  it('builds again with the platform’s own when building with the template fails, and tells the editor', async () => {
    given([row('slack', { title: 'T' })]);
    const templates = await templatesFor('eventConfirmed');
    const built = templates.build('slack', (context) => {
      if (context.template) throw new Error('boom');
      return 'default';
    });
    expect(built).toBe('default');
    expect(console.error).toHaveBeenCalled();
    expect(prisma.notificationTemplate.update).toHaveBeenCalledWith({
      where: { type_scope: { type: 'eventConfirmed', scope: 'slack' } },
      data: expect.objectContaining({ lastFallbackReason: 'render:failed' }),
    });
  });

  it('does not hide a failure of the platform’s own build: there is nothing to fall back on', async () => {
    given([]);
    const templates = await templatesFor('eventConfirmed');
    expect(() =>
      templates.build('slack', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});

describe('{@staff} in the messages for the school’s staff', () => {
  const staffRow = (scope: string, content: unknown) =>
    row(scope, content, { type: 'intraRequested' });

  beforeEach(() => {
    mocks.audience.mockResolvedValue({
      emails: ['sophie@example.org'],
      discordIds: ['348291047563210241'],
      slackIds: ['U04ABCD1234'],
      fallsBackOnOwners: false,
    });
  });

  it('gives each channel the people who gave their id, for a message to the staff', async () => {
    given([staffRow('all', { above: 'Allô {@staff}' })]);
    const templates = await templatesFor('intraRequested');
    for (const channel of ['discord', 'slack', 'email'] as const) {
      expect(templates.context(channel).staff).toEqual({
        discord: ['348291047563210241'],
        slack: ['U04ABCD1234'],
      });
    }
    expect(templates.context('discord').template).toEqual({ above: 'Allô {@staff}' });
  });

  it('does not even look the staff up for any other message', async () => {
    given([]);
    for (const type of [
      'eventConfirmed',
      'intraPublished',
      'intraRefused',
      'memberPending',
    ] as const) {
      const templates = await templatesFor(type);
      expect(templates.context('discord').staff).toBeUndefined();
    }
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it('sends the platform’s own message, and mentions nobody, when the staff cannot be read', async () => {
    mocks.audience.mockRejectedValue(new Error('database down'));
    given([]);
    const templates = await templatesFor('intraRequested');
    expect(templates.context('discord').staff).toBeUndefined();
    expect(templates.context('discord').bdeName).toBe('BDE Nice');
  });

  it('keeps the staff when a template could not be used and the platform’s own is sent', async () => {
    given([staffRow('discord', { title: '{nothing}' })]);
    const templates = await templatesFor('intraRequested');
    expect(templates.context('discord').template).toBeUndefined();
    expect(templates.context('discord').staff?.discord).toEqual(['348291047563210241']);
  });
});

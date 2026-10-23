// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server side of the notifications page: nothing without the permission (a crafted request is refused by a throw, before
 * anything is read or written), the input is read again, and the writing is the service's (tested apart). The actions that change
 * what the page shows answer the address to load, in the language of the person.
 */

const mocks = vi.hoisted(() => ({
  requireEditor: vi.fn(),
  service: {
    saveTemplate: vi.fn(),
    customizeChannel: vi.fn(),
    resetTemplate: vi.fn(),
    resetType: vi.fn(),
    restoreVersion: vi.fn(),
    acknowledgeRevision: vi.fn(),
    addMention: vi.fn(),
    removeMention: vi.fn(),
  },
  loadMentions: vi.fn(),
  renderPreview: vi.fn(),
  previewOptions: vi.fn(),
  sendTest: vi.fn(),
  findVersions: vi.fn(),
}));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'fr' }));
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({
    href,
    locale,
  }: {
    href: { pathname: string; query: Record<string, string> };
    locale: string;
  }) => `/${locale}${href.pathname}?${new URLSearchParams(href.query).toString()}`,
}));
vi.mock('@/lib/notifications/templates/access', () => ({
  requireTemplateEditor: mocks.requireEditor,
}));
vi.mock('@/lib/notifications/templates/service', () => mocks.service);
vi.mock('@/lib/notifications/templates/store', () => ({ loadMentions: mocks.loadMentions }));
vi.mock('@/lib/notifications/templates/preview', () => ({ renderPreview: mocks.renderPreview }));
vi.mock('@/lib/notifications/templates/test-send', () => ({
  previewOptions: mocks.previewOptions,
  sendTemplateTest: mocks.sendTest,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { notificationTemplateVersion: { findMany: mocks.findVersions } },
}));

const actions = await import('./actions');

const EDITOR = { user: { login: 'paula', id: 'u-paula', email: 'paula@exemple.fr' } };
const ACTOR = { login: 'paula', id: 'u-paula' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEditor.mockResolvedValue(EDITOR);
  mocks.loadMentions.mockResolvedValue({ rows: [], directory: {} });
  mocks.previewOptions.mockResolvedValue({ locale: 'fr' });
  for (const service of Object.values(mocks.service)) service.mockResolvedValue({ ok: true });
});

const CALLS: Array<[string, (input: unknown) => Promise<unknown>, unknown]> = [
  [
    'saveTemplate',
    actions.saveTemplate,
    { type: 'eventConfirmed', scope: 'all', content: {}, expectedVersion: 0 },
  ],
  ['customizeChannel', actions.customizeChannel, { type: 'eventConfirmed', channel: 'slack' }],
  ['resetTemplate', actions.resetTemplate, { type: 'eventConfirmed', scope: 'all' }],
  ['resetNotification', actions.resetNotification, { type: 'eventConfirmed' }],
  ['restoreVersion', actions.restoreVersion, { type: 'eventConfirmed', scope: 'all', version: 1 }],
  ['acknowledgeRevision', actions.acknowledgeRevision, { type: 'eventConfirmed', scope: 'all' }],
  [
    'addMention',
    actions.addMention,
    {
      platform: 'discord',
      kind: 'role',
      key: 'bureau',
      label: 'Bureau',
      externalId: '123456789012345678',
    },
  ],
  ['removeMention', actions.removeMention, { id: 'm1' }],
  [
    'previewTemplate',
    actions.previewTemplate,
    { type: 'eventConfirmed', channel: 'discord', drafts: {} },
  ],
  [
    'sendTemplateTestMessage',
    actions.sendTemplateTestMessage,
    { type: 'eventConfirmed', channel: 'discord', drafts: {}, withMentions: false },
  ],
  ['loadHistory', actions.loadHistory, { type: 'eventConfirmed', scope: 'all' }],
];

describe('every action is an entry point of its own', () => {
  for (const [name, action, input] of CALLS) {
    it(`${name} is refused without the permission, before anything is read or written`, async () => {
      mocks.requireEditor.mockRejectedValue(new Error('Forbidden'));
      await expect(action(input)).rejects.toThrow('Forbidden');
      for (const service of Object.values(mocks.service)) expect(service).not.toHaveBeenCalled();
      expect(mocks.sendTest).not.toHaveBeenCalled();
      expect(mocks.findVersions).not.toHaveBeenCalled();
      expect(mocks.loadMentions).not.toHaveBeenCalled();
    });

    it(`${name} reads its input again: a crafted one throws before the service is asked`, async () => {
      await expect(
        action({ type: 'nope', scope: 'nope', channel: 'nope', id: 1 }),
      ).rejects.toThrow();
      await expect(action(null)).rejects.toThrow();
      for (const service of Object.values(mocks.service)) expect(service).not.toHaveBeenCalled();
      expect(mocks.sendTest).not.toHaveBeenCalled();
    });
  }
});

describe('what an action writes is the service’s, as the person who asks', () => {
  it('saves for the person behind the request', async () => {
    mocks.service.saveTemplate.mockResolvedValue({ ok: true, version: 2, changed: true });
    const input = {
      type: 'eventConfirmed',
      scope: 'all',
      content: { title: 'x' },
      expectedVersion: 1,
    };
    expect(await actions.saveTemplate(input)).toEqual({ ok: true, version: 2, changed: true });
    expect(mocks.service.saveTemplate).toHaveBeenCalledWith(input, ACTOR);
  });

  it('answers a refusal as a code the page says in words, never a throw', async () => {
    mocks.service.saveTemplate.mockResolvedValue({ ok: false, code: 'conflict' });
    expect(
      await actions.saveTemplate({
        type: 'eventConfirmed',
        scope: 'all',
        content: {},
        expectedVersion: 0,
      }),
    ).toEqual({ ok: false, code: 'conflict' });
  });

  it('adds and removes somebody to mention for the person behind the request', async () => {
    mocks.service.addMention.mockResolvedValue({ ok: true, id: 'm9' });
    const mention = {
      platform: 'slack',
      kind: 'user',
      key: 'paula',
      label: 'Paula',
      externalId: 'U01ABCDE2F3',
    };
    expect(await actions.addMention(mention)).toEqual({ ok: true, id: 'm9' });
    expect(mocks.service.addMention).toHaveBeenCalledWith(mention, ACTOR);
    await actions.removeMention({ id: 'm9' });
    expect(mocks.service.removeMention).toHaveBeenCalledWith({ id: 'm9' }, ACTOR);
  });
});

describe('the actions that change what the page shows send the browser to load it again', () => {
  const cases: Array<[string, (input: unknown) => Promise<unknown>, unknown, string]> = [
    [
      'customizeChannel',
      actions.customizeChannel,
      { type: 'eventConfirmed', channel: 'slack' },
      'scope=slack&notice=customised',
    ],
    [
      'resetTemplate',
      actions.resetTemplate,
      { type: 'eventConfirmed', scope: 'email' },
      'scope=email&notice=reset',
    ],
    [
      'resetNotification',
      actions.resetNotification,
      { type: 'eventConfirmed' },
      'scope=all&notice=resetAll',
    ],
    [
      'restoreVersion',
      actions.restoreVersion,
      { type: 'eventConfirmed', scope: 'all', version: 3 },
      'scope=all&notice=restored',
    ],
    [
      'acknowledgeRevision',
      actions.acknowledgeRevision,
      { type: 'eventConfirmed', scope: 'discord' },
      'scope=discord&notice=acknowledged',
    ],
  ];
  for (const [name, action, input, expected] of cases) {
    it(`${name} answers an address on the same notification`, async () => {
      const answer = (await action(input)) as { href: string };
      expect(answer.href).toBe(`/fr/notifications?type=eventConfirmed&${expected}`);
    });
  }

  it('answers the code instead when the service refuses', async () => {
    mocks.service.customizeChannel.mockResolvedValue({ ok: false, code: 'conflict' });
    expect(await actions.customizeChannel({ type: 'eventConfirmed', channel: 'slack' })).toEqual({
      ok: false,
      code: 'conflict',
    });
  });
});

describe('the preview', () => {
  it('is drawn from the drafts as they would be saved, with the BDE’s directory, and writes nothing', async () => {
    mocks.renderPreview.mockResolvedValue({ channel: 'discord', embed: { title: 'T' } });
    const answer = await actions.previewTemplate({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: 'Mon {title}' }, own: null },
    });
    expect(answer).toEqual({ ok: true, preview: { channel: 'discord', embed: { title: 'T' } } });
    const template = mocks.renderPreview.mock.calls[0]![2];
    expect(template).toEqual({ title: 'Mon {title}' });
    for (const service of Object.values(mocks.service)) expect(service).not.toHaveBeenCalled();
  });

  it('says what is wrong with a draft instead of drawing it', async () => {
    const answer = (await actions.previewTemplate({
      type: 'eventConfirmed',
      channel: 'discord',
      drafts: { all: { title: '{nothing}' } },
    })) as { ok: boolean; code: string; issues: Array<{ code: string }> };
    expect(answer.ok).toBe(false);
    expect(answer.code).toBe('invalid');
    expect(answer.issues[0]!.code).toBe('unknownVariable');
    expect(mocks.renderPreview).not.toHaveBeenCalled();
  });
});

describe('the test message', () => {
  it('goes to the address of the person who asks, for the e-mail', async () => {
    mocks.sendTest.mockResolvedValue({ ok: true });
    const input = {
      type: 'eventConfirmed',
      channel: 'email',
      drafts: { all: { title: 'x' } },
      withMentions: true,
    };
    expect(await actions.sendTemplateTestMessage(input)).toEqual({ ok: true });
    expect(mocks.sendTest).toHaveBeenCalledWith({ ...input, to: 'paula@exemple.fr' });
  });

  it('has no address to write to when the account has none', async () => {
    mocks.requireEditor.mockResolvedValue({ user: { login: 'paula', id: 'u-paula' } });
    mocks.sendTest.mockResolvedValue({ ok: false, code: 'notConfigured' });
    await actions.sendTemplateTestMessage({
      type: 'eventConfirmed',
      channel: 'email',
      drafts: {},
      withMentions: false,
    });
    expect(mocks.sendTest.mock.calls[0]![0].to).toBeNull();
  });
});

describe('the history', () => {
  it('lists the versions newest first, saying what made each, and gives no content', async () => {
    mocks.findVersions.mockResolvedValue([
      {
        version: 3,
        action: 'restore:1',
        authorLogin: 'paula',
        createdAt: new Date('2026-10-22T10:00:00Z'),
        content: { title: 'x' },
      },
      {
        version: 2,
        action: 'reset',
        authorLogin: 'sam',
        createdAt: new Date('2026-10-21T10:00:00Z'),
        content: null,
      },
      {
        version: 1,
        action: 'save',
        authorLogin: 'sam',
        createdAt: new Date('2026-10-20T10:00:00Z'),
        content: { title: 'y' },
      },
    ]);
    const result = await actions.loadHistory({ type: 'eventConfirmed', scope: 'all' });
    expect(result.entries).toEqual([
      {
        version: 3,
        action: 'restore',
        restoredFrom: 1,
        authorLogin: 'paula',
        createdAt: '2026-10-22T10:00:00.000Z',
        reset: false,
      },
      {
        version: 2,
        action: 'reset',
        authorLogin: 'sam',
        createdAt: '2026-10-21T10:00:00.000Z',
        reset: true,
      },
      {
        version: 1,
        action: 'save',
        authorLogin: 'sam',
        createdAt: '2026-10-20T10:00:00.000Z',
        reset: false,
      },
    ]);
    expect(mocks.findVersions.mock.calls[0]![0].where).toEqual({
      type: 'eventConfirmed',
      scope: 'all',
    });
  });
});

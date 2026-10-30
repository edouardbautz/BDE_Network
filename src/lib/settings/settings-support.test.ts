// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeConfigSchema } from '@/config/schema';
import { forgetApplicationToken, applicationToken } from './fortytwo-token';
import { reconcileOwnerAccounts, syncOwnerAccounts } from './owners';
import { setRuntimeSettings } from './runtime';
import { settingsExtras, settingsView } from './view';

const mocks = vi.hoisted(() => ({ groupBy: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { event: { groupBy: mocks.groupBy } } }));

const config = (notifications: Record<string, unknown> = {}) =>
  bdeConfigSchema.parse({
    bde: {
      name: 'BDE Test',
      campus: 'Nice',
      timezone: 'Europe/Paris',
      defaultLocale: 'en',
      accentColor: '#0f766e',
      logoPath: '/logo.svg',
    },
    auth: { owners: ['alice', 'bob'], allowedCampuses: ['Nice'] },
    modules: { enabled: ['events'] },
    events: {
      categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
      reminderHour: 18,
    },
    notifications,
  });

describe('settingsView: what the page may show', () => {
  beforeEach(() => setRuntimeSettings(undefined));
  afterEach(() => setRuntimeSettings(undefined));

  it('says how a saved secret ends, and nothing more of it (never a password somebody chose)', () => {
    setRuntimeSettings({
      config: config({ eventConfirmed: 'discord' }),
      values: {
        FORTYTWO_CLIENT_SECRET: 's-s4t2ud-0123456789abcdef',
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abcdefghijklmnop-a1b2',
        DISCORD_STAFF_WEBHOOK_URL: 'https://discord.com/api/webhooks/2/qrstuvwxyz0123456-c3d4',
        SMTP_PASSWORD: 'a-password-somebody-chose',
      },
      source: 'database',
    });
    const view = settingsView();
    expect(view.clientSecretTail).toBe('cdef');
    expect(view.notifications.discordWebhookTail).toBe('a1b2');
    expect(view.notifications.slackWebhookTail).toBeNull();
    // the mail password has no end: it is a word a person chose
    expect(JSON.stringify(view)).not.toContain('somebody');
    expect(JSON.stringify(view)).not.toContain('chose');
    // and what is said of an address is four characters of it, not the address
    expect(JSON.stringify(view)).not.toContain('abcdefghijkl');
    expect(JSON.stringify(view)).not.toContain('0123456789');
  });

  it('is the installer’s shape, with no secret, only whether there is one', () => {
    setRuntimeSettings({
      config: config({ eventConfirmed: 'discord', memberPending: 'discord' }),
      values: {
        APP_URL: 'https://bde.exemple.fr',
        FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
        FORTYTWO_CLIENT_SECRET: 's-s4t2ud-very-secret',
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/very-secret-hook',
        SMTP_HOST: 'smtp.exemple.fr',
        SMTP_PASSWORD: 'very-secret-password',
      },
      source: 'database',
    });

    const view = settingsView();
    const text = JSON.stringify(view);
    for (const secret of ['very-secret', 'very-secret-hook', 'very-secret-password']) {
      expect(text).not.toContain(secret);
    }
    expect(view).toMatchObject({
      name: 'BDE Test',
      accentColor: '#0f766e',
      messageLocale: 'en',
      addressUrl: 'https://bde.exemple.fr',
      clientId: 'u-s4t2ud-uid-abcdef',
      hasClientSecret: true,
      campuses: ['Nice'],
      mainCampus: 'Nice',
      owners: ['alice', 'bob'],
      events: true,
    });
    expect(view.notifications).toMatchObject({
      // the configuration says one channel per notification, as it did before 1.5.0: it is read as a list
      matrix: { eventConfirmed: ['discord'], memberPending: ['discord'], memberApproved: [] },
      hasDiscordWebhook: true,
      hasSlackWebhook: false,
      hasSmtp: false, // the host and the password are saved, not the port and the sender
      smtp: { host: 'smtp.exemple.fr', hasPassword: true },
    });
  });

  it('shows several channels for a notification, in the order of the table, and no e-mail for a member removed', () => {
    setRuntimeSettings({
      config: config({
        eventConfirmed: ['email', 'discord'],
        memberRemoved: ['slack', 'email'],
      }),
      values: {},
      source: 'database',
    });
    const { matrix } = settingsView().notifications;
    expect(matrix.eventConfirmed).toEqual(['discord', 'email']);
    // the e-mail of a removed member never exists: an older configuration may list it, the page does not show it
    expect(matrix.memberRemoved).toEqual(['slack']);
  });

  it('says nothing is ticked when nothing is sent, and no secret when none is saved', () => {
    setRuntimeSettings({ config: config(), values: {}, source: 'database' });
    const view = settingsView();
    expect(
      Object.values(view.notifications.matrix).every((channels) => channels.length === 0),
    ).toBe(true);
    expect(view.hasClientSecret).toBe(false);
    expect(view.addressUrl).toBe('');
  });
});

describe('settingsExtras: what only the settings page shows', () => {
  beforeEach(() => {
    setRuntimeSettings(undefined);
    mocks.groupBy.mockReset();
  });
  afterEach(() => setRuntimeSettings(undefined));

  const load = (cfg = config()) =>
    setRuntimeSettings({ config: cfg, values: {}, source: 'database' });

  it('has the categories, how many events each has, the hour and the time zone', async () => {
    load();
    mocks.groupBy.mockResolvedValue([{ categoryKey: 'soiree', _count: { _all: 7 } }]);
    expect(await settingsExtras()).toEqual({
      logo: { path: '/logo.svg', custom: false },
      updates: { check: true },
      events: {
        categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
        usage: { soiree: 7 },
        reminderHour: 18,
        intraPublication: false,
        staffChannel: {
          hasDiscordWebhook: false,
          hasSlackWebhook: false,
          discordWebhookTail: null,
          slackWebhookTail: null,
        },
        timezone: 'Europe/Paris',
      },
    });
  });

  it('knows an uploaded logo from the default one', async () => {
    const cfg = config();
    cfg.bde.logoPath = '/api/logo?v=0123456789abcdef';
    load(cfg);
    mocks.groupBy.mockResolvedValue([]);
    expect((await settingsExtras()).logo).toEqual({
      path: '/api/logo?v=0123456789abcdef',
      custom: true,
    });
  });

  it('has nothing about events, and does not ask the database, while the module is off', async () => {
    load(config());
    const off = config();
    off.modules.enabled = [];
    load(off);
    expect((await settingsExtras()).events).toBeNull();
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });
});

describe('applicationToken', () => {
  beforeEach(() => {
    forgetApplicationToken();
    setRuntimeSettings({
      config: config(),
      values: {
        FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
        FORTYTWO_CLIENT_SECRET: 's-s4t2ud-secret-abcdef',
      },
      source: 'database',
    });
  });
  afterEach(() => setRuntimeSettings(undefined));

  const answers = (status: number, body: unknown = {}) =>
    vi.fn(async () => Response.json(body, { status }));

  it('asks 42 with the saved credentials, once for half an hour', async () => {
    const fetchFn = answers(200, { access_token: 'tok-1' });
    let now = 1_000_000;
    expect(await applicationToken(fetchFn, () => now)).toBe('tok-1');
    now += 29 * 60_000;
    expect(await applicationToken(fetchFn, () => now)).toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await applicationToken(fetchFn, () => now);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('forgets the token as soon as the credentials change', async () => {
    const fetchFn = answers(200, { access_token: 'tok-1' });
    await applicationToken(fetchFn);
    setRuntimeSettings({
      config: config(),
      values: {
        FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
        FORTYTWO_CLIENT_SECRET: 's-s4t2ud-another-secret',
      },
      source: 'database',
    });
    await applicationToken(fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('is null when 42 refuses the application, cannot be reached, or there is nothing saved', async () => {
    expect(await applicationToken(answers(401, { error: 'invalid_client' }))).toBeNull();
    expect(
      await applicationToken(
        vi.fn(async () => {
          throw new TypeError('offline');
        }),
      ),
    ).toBeNull();
    setRuntimeSettings({ config: config(), values: {}, source: 'database' });
    const fetchFn = answers(200, { access_token: 'x' });
    expect(await applicationToken(fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

interface Account {
  id: string;
  login: string;
  status: 'OWNER' | 'MEMBER' | 'PENDING';
  roleId: string | null;
}

function fakeAccounts(accounts: Account[], defaultRole: string | null = 'role-default') {
  const audit: Array<Record<string, unknown>> = [];
  const tx = {
    user: {
      findMany: async () => accounts.map((a) => ({ ...a })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: Partial<Account>;
      }) => {
        for (const a of accounts) if (where.id.in.includes(a.id)) Object.assign(a, data);
        return { count: 1 };
      },
    },
    role: { findFirst: async () => (defaultRole ? { id: defaultRole } : null) },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => void audit.push(data),
    },
  };
  return {
    tx,
    audit,
    db: { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as never,
  };
}

describe('the accounts follow the owners', () => {
  const accounts = (): Account[] => [
    { id: '1', login: 'alice', status: 'OWNER', roleId: null },
    { id: '2', login: 'bob', status: 'MEMBER', roleId: 'role-x' },
    { id: '3', login: 'carol', status: 'OWNER', roleId: null },
    { id: '4', login: 'dave', status: 'PENDING', roleId: null },
  ];

  it('promotes a listed account, demotes an OWNER who is not listed, touches nobody else', async () => {
    const list = accounts();
    const { tx } = fakeAccounts(list);
    const result = await syncOwnerAccounts(tx as never, ['Alice', 'bob']);

    expect(result).toEqual({ promoted: ['bob'], demoted: ['carol'] });
    expect(list.find((a) => a.login === 'bob')).toMatchObject({ status: 'OWNER', roleId: null });
    expect(list.find((a) => a.login === 'carol')).toMatchObject({
      status: 'MEMBER',
      roleId: 'role-default',
    });
    expect(list.find((a) => a.login === 'alice')?.status).toBe('OWNER');
    expect(list.find((a) => a.login === 'dave')).toMatchObject({ status: 'PENDING', roleId: null });
  });

  it('sends a demoted owner back to waiting when there is no default role', async () => {
    const list = accounts();
    await syncOwnerAccounts(fakeAccounts(list, null).tx as never, ['alice']);
    expect(list.find((a) => a.login === 'carol')).toMatchObject({
      status: 'PENDING',
      roleId: null,
    });
  });

  it('does nothing, and writes nothing, when the accounts already agree', async () => {
    const { tx } = fakeAccounts([{ id: '1', login: 'alice', status: 'OWNER', roleId: null }]);
    const update = vi.spyOn(tx.user, 'updateMany');
    expect(await syncOwnerAccounts(tx as never, ['alice'])).toEqual({ promoted: [], demoted: [] });
    expect(update).not.toHaveBeenCalled();
  });

  it('at start-up, audits every change in the name of "system", and nothing when there is none', async () => {
    const { db, audit } = fakeAccounts(accounts());
    await reconcileOwnerAccounts(['alice', 'bob'], db);
    expect(audit.map((entry) => [entry.actorLogin, entry.action, entry.targetLabel])).toEqual([
      ['system', 'settings.owner.sync', 'bob'],
      ['system', 'settings.owner.sync', 'carol'],
    ]);

    const again = fakeAccounts([{ id: '1', login: 'alice', status: 'OWNER', roleId: null }]);
    await reconcileOwnerAccounts(['alice'], again.db);
    expect(again.audit).toEqual([]);
  });
});

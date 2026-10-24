// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeConfigSchema, type BdeConfig } from '@/config/schema';
import { seal, settingsKey, unseal } from './crypto';
import { getRuntimeSettings, setRuntimeSettings, setting, type SettingValues } from './runtime';
import { updateSettings, type SettingsChange } from './update';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const baseConfig = (overrides: Partial<Record<string, unknown>> = {}): BdeConfig =>
  bdeConfigSchema.parse({
    bde: {
      name: 'BDE Test',
      campus: 'Nice',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#0f766e',
      logoPath: '/logo.svg',
    },
    auth: { owners: ['alice', 'bob'], allowedCampuses: ['Nice', 'Paris'] },
    modules: { enabled: ['events'] },
    events: {
      categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }],
      reminderHour: 18,
    },
    notifications: { memberPending: 'none', memberApproved: 'none', memberRemoved: 'none' },
    ...overrides,
  });

const baseValues: SettingValues = {
  APP_URL: 'https://bde.exemple.fr',
  FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
  FORTYTWO_CLIENT_SECRET: 's-s4t2ud-the-old-secret',
};

interface Account {
  id: string;
  login: string;
  status: 'OWNER' | 'MEMBER' | 'PENDING';
  roleId: string | null;
}

/** A database with the few tables a settings change touches, and transactions that roll back. */
function fakeDb(
  options: {
    config?: BdeConfig;
    values?: SettingValues;
    accounts?: Account[];
    events?: Array<{ id: string; categoryKey: string }>;
  } = {},
) {
  const config = options.config ?? baseConfig();
  const values = options.values ?? baseValues;
  const secretNames = [
    'FORTYTWO_CLIENT_SECRET',
    'SMTP_PASSWORD',
    'DISCORD_WEBHOOK_URL',
    'SLACK_WEBHOOK_URL',
    'DISCORD_STAFF_WEBHOOK_URL',
    'SLACK_STAFF_WEBHOOK_URL',
  ];
  const secrets = Object.fromEntries(
    Object.entries(values).filter(([k]) => secretNames.includes(k)),
  );
  const environment = Object.fromEntries(
    Object.entries(values).filter(([k]) => !secretNames.includes(k)),
  );

  const state = {
    row: {
      id: 'platform',
      config: JSON.parse(JSON.stringify(config)) as unknown,
      environment: environment as unknown,
      secrets: seal(secrets as Record<string, string>, settingsKey()) as string | null,
      source: 'installer',
      installedAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    } as Record<string, unknown> | null,
    accounts: options.accounts ?? [],
    events: options.events ?? [],
    audit: [] as Array<Record<string, unknown>>,
    defaultRole: 'role-default' as string | null,
    /** Called once, before the write: another save lands in between. */
    beforeWrite: undefined as (() => void) | undefined,
    clock: 1,
  };

  const matches = (account: Account, where: Record<string, unknown>): boolean => {
    const or = where.OR as Array<Record<string, unknown>> | undefined;
    if (or) {
      return or.some((clause) => {
        if (clause.status) return account.status === clause.status;
        const equals = (clause.login as { equals: string }).equals;
        return account.login.toLowerCase() === equals.toLowerCase();
      });
    }
    const ids = (where.id as { in: string[] } | undefined)?.in;
    return ids ? ids.includes(account.id) : true;
  };

  const tx = {
    platformSettings: {
      findUnique: async () => (state.row ? { ...state.row } : null),
      updateMany: async ({
        where,
        data,
      }: {
        where: { updatedAt: Date };
        data: Record<string, unknown>;
      }) => {
        state.beforeWrite?.();
        state.beforeWrite = undefined;
        if (!state.row || (state.row.updatedAt as Date).getTime() !== where.updatedAt.getTime()) {
          return { count: 0 };
        }
        state.row = {
          ...state.row,
          ...data,
          updatedAt: new Date(Date.UTC(2026, 9, 1, 10, 0, ++state.clock)),
        };
        return { count: 1 };
      },
    },
    user: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.accounts.filter((account) => matches(account, where)).map((a) => ({ ...a })),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Account>;
      }) => {
        for (const account of state.accounts)
          if (matches(account, where)) Object.assign(account, data);
        return { count: 1 };
      },
    },
    event: {
      count: async ({ where }: { where: { categoryKey: string } }) =>
        state.events.filter((event) => event.categoryKey === where.categoryKey).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: { categoryKey: string };
        data: { categoryKey: string };
      }) => {
        const hit = state.events.filter((event) => event.categoryKey === where.categoryKey);
        for (const event of hit) event.categoryKey = data.categoryKey;
        return { count: hit.length };
      },
    },
    role: { findFirst: async () => (state.defaultRole ? { id: state.defaultRole } : null) },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => void state.audit.push(data),
    },
  };

  const db = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone({
        row: state.row,
        accounts: state.accounts,
        events: state.events,
        audit: state.audit,
      });
      try {
        return await fn(tx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  } as never;

  return { db, state };
}

const alice = { login: 'alice', id: 'u-alice' };
const run = (change: SettingsChange, db: never, actor = alice) => updateSettings(change, actor, db);

beforeEach(() => {
  setRuntimeSettings(undefined);
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(44));
  vi.stubEnv('DATABASE_URL', 'postgresql://bde:pw@postgres:5432/bde_network?schema=public');
});
afterEach(() => {
  setRuntimeSettings(undefined);
  vi.unstubAllEnvs();
});

describe('what a change does', () => {
  it('writes it, audits it in the same transaction, and loads it at once (no restart)', async () => {
    const { db, state } = fakeDb();
    const result = await run(
      { section: 'identity', name: ' Le BDE ', accentColor: '#ABC', messageLocale: 'en' },
      db,
    );

    expect(result).toEqual({ ok: true, changed: true });
    expect((state.row?.config as BdeConfig).bde).toMatchObject({
      name: 'Le BDE',
      accentColor: '#aabbcc',
      defaultLocale: 'en',
    });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      actorLogin: 'alice',
      actorId: 'u-alice',
      action: 'settings.identity.update',
      targetType: 'Settings',
    });
    expect(getRuntimeSettings()?.config.bde.name).toBe('Le BDE');
    expect(getRuntimeSettings()?.source).toBe('database');
  });

  it('writes nothing, and audits nothing, when the values are already these', async () => {
    const { db, state } = fakeDb();
    const before = state.row;
    const result = await run(
      { section: 'identity', name: 'BDE Test', accentColor: '#0f766e', messageLocale: 'fr' },
      db,
    );
    expect(result).toEqual({ ok: true, changed: false });
    expect(state.row).toEqual(before);
    expect(state.audit).toEqual([]);
  });

  it('refuses when the platform is not installed', async () => {
    const { db, state } = fakeDb();
    state.row = null;
    expect(await run({ section: 'modules', events: false }, db)).toMatchObject({
      ok: false,
      code: 'notInstalled',
    });
  });

  it('refuses to work on secrets it cannot read, instead of dropping them', async () => {
    const { db, state } = fakeDb();
    state.row = {
      ...state.row,
      secrets: seal({ FORTYTWO_CLIENT_SECRET: 'x' }, Buffer.alloc(32, 7)),
    };
    expect(await run({ section: 'modules', events: false }, db)).toMatchObject({
      ok: false,
      code: 'secretsUnreadable',
    });
    expect(state.audit).toEqual([]);
  });

  describe('two owners saving at the same moment', () => {
    it('loses neither change: the second reads the row again', async () => {
      const { db, state } = fakeDb();
      // while the first change is about to be written, another one lands
      state.beforeWrite = () => {
        const row = state.row as { config: BdeConfig; updatedAt: Date };
        state.row = {
          ...state.row,
          config: {
            ...row.config,
            auth: { ...row.config.auth, owners: ['alice', 'bob', 'carol'] },
          },
          updatedAt: new Date('2026-10-01T10:05:00Z'),
        };
      };
      const result = await run({ section: 'modules', events: false }, db);

      expect(result).toEqual({ ok: true, changed: true });
      const config = state.row?.config as BdeConfig;
      expect(config.modules.enabled).toEqual([]); // my change
      expect(config.auth.owners).toEqual(['alice', 'bob', 'carol']); // theirs
      expect(state.audit).toHaveLength(1); // the retry wrote the entry, the first attempt left none
    });

    it('gives up with a code after three lost races', async () => {
      const { db, state } = fakeDb();
      let ticks = 0;
      const original = (db as unknown as { $transaction: (fn: never) => Promise<unknown> })
        .$transaction;
      const racing = {
        $transaction: (fn: never) => {
          state.beforeWrite = () => {
            state.row = { ...state.row, updatedAt: new Date(Date.UTC(2026, 9, 2, 0, 0, ++ticks)) };
          };
          return original(fn);
        },
      } as never;
      expect(await run({ section: 'modules', events: false }, racing)).toMatchObject({
        ok: false,
        code: 'conflict',
      });
    });
  });
});

describe('the sections', () => {
  it('identity: validates the name, the color and the language', async () => {
    const { db } = fakeDb();
    expect(
      await run(
        { section: 'identity', name: ' ', accentColor: '#0f766e', messageLocale: 'fr' },
        db,
      ),
    ).toMatchObject({ ok: false, code: 'name', field: 'name' });
    expect(
      await run({ section: 'identity', name: 'x', accentColor: 'red', messageLocale: 'fr' }, db),
    ).toMatchObject({ ok: false, code: 'color' });
    expect(
      await run({ section: 'identity', name: 'x', accentColor: '#000', messageLocale: 'de' }, db),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('address: wants an explicit yes for plain http on a domain, and keeps the old one in the audit', async () => {
    const { db, state } = fakeDb();
    expect(await run({ section: 'address', address: 'nope' }, db)).toMatchObject({
      ok: false,
      code: 'address',
    });
    expect(await run({ section: 'address', address: 'http://0.0.0.0:3000' }, db)).toMatchObject({
      ok: false,
      code: 'addressUnspecified',
    });
    expect(await run({ section: 'address', address: 'http://bde.exemple.fr' }, db)).toMatchObject({
      ok: false,
      code: 'insecure',
    });
    expect(await run({ section: 'address', address: 'https://nouveau.exemple.fr/' }, db)).toEqual({
      ok: true,
      changed: true,
    });
    expect(setting('APP_URL')).toBe('https://nouveau.exemple.fr');
    expect(state.audit[0]?.metadata).toEqual({
      from: 'https://bde.exemple.fr',
      to: 'https://nouveau.exemple.fr',
    });
  });

  describe('the 42 application', () => {
    it('keeps the saved secret when the field is blank, and replaces it otherwise', async () => {
      const { db } = fakeDb();
      expect(
        await run({ section: 'oauth', clientId: 'u-s4t2ud-newuid-abcd', clientSecret: '' }, db),
      ).toEqual({ ok: true, changed: true });
      expect(setting('FORTYTWO_CLIENT_ID')).toBe('u-s4t2ud-newuid-abcd');
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('s-s4t2ud-the-old-secret');

      expect(
        await run(
          {
            section: 'oauth',
            clientId: 'u-s4t2ud-newuid-abcd',
            clientSecret: 's-s4t2ud-the-new-secret',
          },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('s-s4t2ud-the-new-secret');
    });

    it('audits THAT the secret changed, never what it is, and seals it in the row', async () => {
      const { db, state } = fakeDb();
      await run(
        {
          section: 'oauth',
          clientId: 'u-s4t2ud-uid-abcdef',
          clientSecret: 's-s4t2ud-the-new-secret',
        },
        db,
      );

      expect(state.audit[0]).toMatchObject({
        action: 'settings.oauth.update',
        metadata: { clientIdChanged: false, secretChanged: true },
      });
      const everything = JSON.stringify([state.audit, state.row]);
      expect(everything).not.toContain('the-new-secret');
      expect(everything).not.toContain('the-old-secret');
    });

    it('refuses an identifier or a secret that cannot be one, or that are swapped', async () => {
      const { db } = fakeDb();
      expect(await run({ section: 'oauth', clientId: 'x', clientSecret: '' }, db)).toMatchObject({
        ok: false,
        code: 'clientId',
        field: 'clientId',
      });
      expect(
        await run({ section: 'oauth', clientId: 's-s4t2ud-swapped-abc', clientSecret: '' }, db),
      ).toMatchObject({ ok: false, code: 'swapped' });
      expect(
        await run({ section: 'oauth', clientId: 'u-s4t2ud-uid-abcdef', clientSecret: "it's" }, db),
      ).toMatchObject({ ok: false, code: 'clientSecret' });
    });
  });

  describe('campuses', () => {
    it('are saved with the BDE campus and time zone', async () => {
      const { db } = fakeDb();
      expect(
        await run(
          {
            section: 'campuses',
            campuses: ['Nice', 'Paris', 'Nice'],
            mainCampus: 'Paris',
            timezone: 'Europe/Paris',
          },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
      expect(getRuntimeSettings()?.config.auth.allowedCampuses).toEqual(['Nice', 'Paris']);
      expect(getRuntimeSettings()?.config.bde.campus).toBe('Paris');
    });

    it('cannot leave out the BDE’s own campus (it would lock the BDE out), nor name an unknown zone', async () => {
      const { db } = fakeDb();
      expect(
        await run(
          {
            section: 'campuses',
            campuses: ['Paris'],
            mainCampus: 'Nice',
            timezone: 'Europe/Paris',
          },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'campusNotListed' });
      expect(
        await run(
          { section: 'campuses', campuses: [], mainCampus: 'Nice', timezone: 'Mars/Olympus' },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'timezone' });
    });

    it('can be every campus', async () => {
      const { db } = fakeDb();
      expect(
        await run(
          { section: 'campuses', campuses: [], mainCampus: 'Nice', timezone: 'Europe/Paris' },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
      expect(getRuntimeSettings()?.config.auth.allowedCampuses).toEqual([]);
    });
  });

  describe('modules', () => {
    it('turns events off, keeping their categories, and on again', async () => {
      const { db } = fakeDb();
      await run({ section: 'modules', events: false }, db);
      expect(getRuntimeSettings()?.config.modules.enabled).toEqual([]);
      expect(getRuntimeSettings()?.config.events?.categories).toHaveLength(1);
      await run({ section: 'modules', events: true }, db);
      expect(getRuntimeSettings()?.config.modules.enabled).toEqual(['events']);
    });

    it('turns events on for the first time with the usual categories, and keeps another module’s key', async () => {
      const { db } = fakeDb({
        config: bdeConfigSchema.parse({
          ...baseConfig(),
          modules: { enabled: ['my-fork-module'] },
          events: undefined,
        }),
      });
      await run({ section: 'modules', events: true }, db);
      expect(getRuntimeSettings()?.config.modules.enabled).toEqual(['my-fork-module', 'events']);
      expect(getRuntimeSettings()?.config.events?.categories.length).toBeGreaterThan(1);
    });
  });

  describe('updates', () => {
    it('is on until an owner turns it off, and is audited without anything else', async () => {
      const { db, state } = fakeDb();
      expect(baseConfig().updates.check).toBe(true);
      expect(await run({ section: 'updates', check: false }, db)).toEqual({
        ok: true,
        changed: true,
      });
      expect(getRuntimeSettings()?.config.updates.check).toBe(false);
      expect(state.audit.at(-1)).toMatchObject({
        action: 'settings.updates.update',
        targetType: 'Settings',
        metadata: { check: { from: true, to: false } },
      });
      expect(await run({ section: 'updates', check: true }, db)).toEqual({
        ok: true,
        changed: true,
      });
      expect(getRuntimeSettings()?.config.updates.check).toBe(true);
    });

    it('writes nothing when nothing changes', async () => {
      const { db, state } = fakeDb();
      const before = state.audit.length;
      expect(await run({ section: 'updates', check: true }, db)).toEqual({
        ok: true,
        changed: false,
      });
      expect(state.audit).toHaveLength(before);
    });

    it('refuses anything but a boolean', async () => {
      const { db } = fakeDb();
      expect(
        await run({ section: 'updates', check: 'no' } as unknown as SettingsChange, db),
      ).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('leaves the other settings alone', async () => {
      const { db } = fakeDb();
      await run({ section: 'updates', check: false }, db);
      expect(getRuntimeSettings()?.config.bde.name).toBe('BDE Test');
      expect(getRuntimeSettings()?.config.auth.owners).toEqual(['alice', 'bob']);
    });
  });

  describe('notifications', () => {
    const discord = 'https://discord.com/api/webhooks/123456789/secret-part';
    const slack = 'https://hooks.slack.com/services/T123/B456/slacksecret';
    const smtp = {
      host: 'smtp.exemple.fr',
      port: '587',
      user: 'bde',
      password: 'p4ss',
      from: 'bde@exemple.fr',
    };
    const none = {
      memberPending: [],
      memberApproved: [],
      memberRemoved: [],
      eventConfirmed: [],
      eventReminder: [],
      eventProposed: [],
      eventApproved: [],
      eventRefused: [],
    };
    // what a platform holds for the notifications about the intra when nothing was ticked for them (a page may leave them out)
    const noIntra = {
      intraRequested: [],
      intraChanged: [],
      intraCancelled: [],
      intraPublished: [],
      intraRefused: [],
    };
    const save = (notifications: unknown, db: ReturnType<typeof fakeDb>['db']) =>
      run({ section: 'notifications', notifications }, db);

    it('tick the boxes of a channel, keep its webhook sealed, and audit only what changed, never a secret', async () => {
      const { db, state } = fakeDb();
      expect(
        await save(
          {
            matrix: { ...none, memberPending: ['discord'], eventConfirmed: ['discord'] },
            discordWebhook: discord,
          },
          db,
        ),
      ).toEqual({ ok: true, changed: true });

      expect(getRuntimeSettings()?.config.notifications).toEqual({
        ...none,
        ...noIntra,
        memberPending: ['discord'],
        eventConfirmed: ['discord'],
      });
      expect(setting('DISCORD_WEBHOOK_URL')).toBe(discord);
      expect(state.audit[0]?.metadata).toEqual({
        channels: {
          memberPending: { from: [], to: ['discord'] },
          eventConfirmed: { from: [], to: ['discord'] },
        },
        changedSecrets: ['DISCORD_WEBHOOK_URL'],
      });
      expect(JSON.stringify([state.audit, state.row])).not.toContain('secret-part');
    });

    it('the notifications about the intra: saved with the others, and kept when a page that does not know them saves', async () => {
      const { db, state } = fakeDb();
      await save(
        {
          matrix: { ...none, ...noIntra, intraRequested: ['discord'], intraPublished: ['discord'] },
          discordWebhook: discord,
        },
        db,
      );
      expect(getRuntimeSettings()?.config.notifications.intraRequested).toEqual(['discord']);
      expect(state.audit[0]?.metadata).toMatchObject({
        channels: {
          intraRequested: { from: [], to: ['discord'] },
          intraPublished: { from: [], to: ['discord'] },
        },
      });

      // a page drawn before they existed sends eight keys: what was saved for the others is not erased
      await save({ matrix: { ...none, memberPending: ['discord'] } }, db);
      const lists = getRuntimeSettings()?.config.notifications;
      expect(lists?.memberPending).toEqual(['discord']);
      expect(lists?.intraRequested).toEqual(['discord']);
      expect(lists?.intraPublished).toEqual(['discord']);
    });

    it('refuses a box of the intra ticked for a channel that is not set up, like any other', async () => {
      const { db } = fakeDb();
      expect(
        await save({ matrix: { ...none, ...noIntra, intraChanged: ['slack'] } }, db),
      ).toMatchObject({ ok: false, code: 'channelNotConfigured' });
    });

    it('several channels for one notification, each with its own settings', async () => {
      const { db } = fakeDb();
      expect(
        await save(
          {
            matrix: {
              ...none,
              memberPending: ['discord', 'slack', 'email'],
              eventReminder: ['email'],
            },
            discordWebhook: discord,
            slackWebhook: slack,
            smtp,
          },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
      const lists = getRuntimeSettings()?.config.notifications;
      expect(lists?.memberPending).toEqual(['discord', 'slack', 'email']);
      expect(lists?.eventReminder).toEqual(['email']);
      expect(lists?.memberApproved).toEqual([]);
      expect(setting('DISCORD_WEBHOOK_URL')).toBe(discord);
      expect(setting('SLACK_WEBHOOK_URL')).toBe(slack);
      expect(setting('SMTP_HOST')).toBe('smtp.exemple.fr');
      expect(setting('SMTP_PASSWORD')).toBe('p4ss');
    });

    it('nothing ticked sends nothing, and a blank field keeps what is saved for a channel', async () => {
      const { db } = fakeDb();
      await save({ matrix: { ...none, memberPending: ['discord'] }, discordWebhook: discord }, db);
      // every box cleared: no notification, the channel is still there to be ticked again
      await save({ matrix: none }, db);
      expect(getRuntimeSettings()?.config.notifications).toEqual({ ...none, ...noIntra });
      expect(setting('DISCORD_WEBHOOK_URL')).toBe(discord);
      // …a blank field keeps the address, so the box can be ticked without typing it again
      expect(
        await save({ matrix: { ...none, eventConfirmed: ['discord'] }, discordWebhook: '' }, db),
      ).toEqual({ ok: true, changed: true });
      expect(getRuntimeSettings()?.config.notifications.eventConfirmed).toEqual(['discord']);
    });

    it('removing a channel forgets its settings and clears its boxes, and only its', async () => {
      const { db, state } = fakeDb();
      await save(
        {
          matrix: { ...none, memberPending: ['discord', 'slack'] },
          discordWebhook: discord,
          slackWebhook: slack,
        },
        db,
      );
      expect(
        await save(
          { matrix: { ...none, memberPending: ['discord', 'slack'] }, removed: ['discord'] },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'channelNotConfigured' });

      expect(
        await save({ matrix: { ...none, memberPending: ['slack'] }, removed: ['discord'] }, db),
      ).toEqual({ ok: true, changed: true });
      expect(setting('DISCORD_WEBHOOK_URL')).toBeUndefined();
      expect(setting('SLACK_WEBHOOK_URL')).toBe(slack);
      expect(getRuntimeSettings()?.config.notifications.memberPending).toEqual(['slack']);
      expect(state.audit.at(-1)?.metadata).toMatchObject({
        changedSecrets: ['DISCORD_WEBHOOK_URL'],
      });
    });

    it('refuse a box ticked for a channel that is not set up, or wrongly set up', async () => {
      const { db, state } = fakeDb();
      expect(
        await save({ matrix: { ...none, eventConfirmed: ['slack'] }, slackWebhook: '' }, db),
      ).toMatchObject({ ok: false, code: 'channelNotConfigured', field: 'matrix' });
      expect(
        await save(
          { matrix: { ...none, eventConfirmed: ['slack'] }, slackWebhook: 'http://not-slack' },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'slack' });
      expect(
        await save(
          {
            matrix: { ...none, eventConfirmed: ['email'] },
            smtp: { ...smtp, host: 'bad host' },
          },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'smtpHost' });
      // nothing was written by a refusal
      expect(state.audit).toHaveLength(0);
    });

    it('refuse the e-mail of a member who was removed: the person is never written to', async () => {
      const { db } = fakeDb();
      expect(await save({ matrix: { ...none, memberRemoved: ['email'] }, smtp }, db)).toMatchObject(
        { ok: false, code: 'removedNotEmailed', field: 'matrix' },
      );
      expect(
        await save(
          { matrix: { ...none, memberRemoved: ['discord'] }, discordWebhook: discord },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
    });

    it('refuse what is not a table of lists of channels', async () => {
      const { db } = fakeDb();
      expect(await save({ matrix: { ...none, eventConfirmed: 'discord' } }, db)).toMatchObject({
        ok: false,
        code: 'invalid',
      });
      expect(
        await save({ matrix: { ...none, eventConfirmed: ['carrier-pigeon'] } }, db),
      ).toMatchObject({
        ok: false,
        code: 'invalid',
      });
      expect(await save({ matrix: { memberPending: [] } }, db)).toMatchObject({
        ok: false,
        code: 'invalid',
      });
    });

    it('an installation whose configuration still says one channel per notification is read, and saving the same boxes changes nothing', async () => {
      // a row written before 1.5.0 holds "discord" and "none" (and a key left out): the schema reads them as lists
      const { db, state } = fakeDb({ values: { ...baseValues, DISCORD_WEBHOOK_URL: discord } });
      (state.row?.config as { notifications: unknown }).notifications = {
        memberPending: 'discord',
        eventConfirmed: 'discord',
        memberRemoved: 'none',
      };
      expect(
        await save(
          { matrix: { ...none, memberPending: ['discord'], eventConfirmed: ['discord'] } },
          db,
        ),
      ).toEqual({ ok: true, changed: false });
    });
  });
});

describe('the owners', () => {
  const accounts = (): Account[] => [
    { id: 'u-alice', login: 'alice', status: 'OWNER', roleId: null },
    { id: 'u-bob', login: 'bob', status: 'OWNER', roleId: null },
    { id: 'u-carol', login: 'carol', status: 'MEMBER', roleId: 'role-x' },
    { id: 'u-dave', login: 'dave', status: 'PENDING', roleId: null },
  ];

  it('adding one makes an existing account OWNER at once, not at its next sign-in', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    expect(await run({ section: 'owner-add', login: ' Carol ' }, db)).toEqual({
      ok: true,
      changed: true,
    });

    expect(getRuntimeSettings()?.config.auth.owners).toEqual(['alice', 'bob', 'carol']);
    expect(state.accounts.find((a) => a.login === 'carol')).toMatchObject({
      status: 'OWNER',
      roleId: null,
    });
    expect(state.audit[0]).toMatchObject({
      action: 'settings.owner.add',
      targetLabel: 'carol',
      metadata: { promoted: ['carol'], demoted: [] },
    });
  });

  it('adding one who has no account yet waits for their first sign-in', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    expect(await run({ section: 'owner-add', login: 'erin' }, db)).toEqual({
      ok: true,
      changed: true,
    });
    expect(state.accounts.some((a) => a.login === 'erin')).toBe(false);
  });

  it('removing one takes OWNER away at once, and gives the default role (they would otherwise keep it for weeks)', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    expect(await run({ section: 'owner-remove', login: 'bob' }, db)).toEqual({
      ok: true,
      changed: true,
    });

    expect(getRuntimeSettings()?.config.auth.owners).toEqual(['alice']);
    expect(state.accounts.find((a) => a.login === 'bob')).toMatchObject({
      status: 'MEMBER',
      roleId: 'role-default',
    });
    expect(state.accounts.find((a) => a.login === 'alice')?.status).toBe('OWNER');
    expect(state.audit[0]).toMatchObject({
      action: 'settings.owner.remove',
      targetLabel: 'bob',
      metadata: { demoted: ['bob'] },
    });
  });

  it('removing one when there is no default role sends them back to waiting for approval', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    state.defaultRole = null;
    await run({ section: 'owner-remove', login: 'bob' }, db);
    expect(state.accounts.find((a) => a.login === 'bob')).toMatchObject({
      status: 'PENDING',
      roleId: null,
    });
  });

  it('can never remove oneself, nor leave nobody', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    expect(await run({ section: 'owner-remove', login: 'alice' }, db)).toMatchObject({
      ok: false,
      code: 'ownerSelf',
    });
    expect(await run({ section: 'owner-remove', login: 'ALICE' }, db)).toMatchObject({
      ok: false,
      code: 'ownerSelf',
    });

    const lone = fakeDb({
      config: baseConfig({ auth: { owners: ['alice'], allowedCampuses: [] } }),
    });
    expect(await run({ section: 'owner-remove', login: 'alice' }, lone.db)).toMatchObject({
      ok: false,
      code: 'ownerSelf',
    });
    expect(
      await run({ section: 'owner-remove', login: 'bob' }, lone.db, { login: 'zed', id: 'u-zed' }),
    ).toMatchObject({ ok: false, code: 'ownerNotFound' });
    expect(state.audit).toEqual([]);
    expect(lone.state.audit).toEqual([]);
  });

  it('never leaves nobody, even when the one who asks is an owner account the list does not name', async () => {
    const lone = fakeDb({
      config: baseConfig({ auth: { owners: ['alice'], allowedCampuses: [] } }),
    });
    expect(
      await run({ section: 'owner-remove', login: 'alice' }, lone.db, {
        login: 'zed',
        id: 'u-zed',
      }),
    ).toMatchObject({ ok: false, code: 'noOwner' });
    expect(lone.state.audit).toEqual([]);
  });

  it('refuses a login that is already an owner, a bad one, and too many', async () => {
    const { db } = fakeDb({ accounts: accounts() });
    expect(await run({ section: 'owner-add', login: 'ALICE' }, db)).toMatchObject({
      ok: false,
      code: 'ownerExists',
    });
    expect(await run({ section: 'owner-add', login: 'a b' }, db)).toMatchObject({
      ok: false,
      code: 'login',
    });

    const many = fakeDb({
      config: baseConfig({
        auth: { owners: Array.from({ length: 30 }, (_, i) => `owner${i}`), allowedCampuses: [] },
      }),
    });
    expect(await run({ section: 'owner-add', login: 'one-more' }, many.db)).toMatchObject({
      ok: false,
      code: 'tooManyOwners',
    });
  });

  it('rolls back everything when something fails inside the transaction', async () => {
    const { db, state } = fakeDb({ accounts: accounts() });
    const before = JSON.stringify(state.accounts);
    const broken = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        (db as unknown as { $transaction: (f: never) => Promise<unknown> }).$transaction(((tx: {
          auditLog: { create: () => Promise<never> };
        }) => {
          tx.auditLog.create = async () => {
            throw new Error('audit table is gone');
          };
          return fn(tx);
        }) as never),
    } as never;

    await expect(run({ section: 'owner-remove', login: 'bob' }, broken)).rejects.toThrow(
      'audit table',
    );
    expect(JSON.stringify(state.accounts)).toBe(before); // bob is still an OWNER: no change without its audit entry
    expect(state.row?.config).toEqual(JSON.parse(JSON.stringify(baseConfig())));
  });
});

describe('what is never accepted', () => {
  it('a change that would leave a platform that cannot start', async () => {
    // e-mail needs a mail server; the check of the platform's own rules runs on the whole result
    const { db, state } = fakeDb();
    const result = await run(
      {
        section: 'notifications',
        notifications: {
          matrix: {
            memberPending: ['email'],
            memberApproved: [],
            memberRemoved: [],
            eventConfirmed: [],
            eventReminder: [],
            eventProposed: [],
            eventApproved: [],
            eventRefused: [],
          },
          smtp: {
            host: 'smtp.exemple.fr',
            port: '587',
            user: '',
            password: '',
            from: 'bde@exemple.fr',
          },
        },
      },
      db,
    );
    expect(result).toEqual({ ok: true, changed: true }); // valid: user and password are optional
    expect(state.audit).toHaveLength(1);
  });

  it('keeps unrelated stored values out of the settings (only the managed ones are read)', async () => {
    const { db, state } = fakeDb();
    state.row = {
      ...state.row,
      environment: {
        APP_URL: 'https://bde.exemple.fr',
        FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
        AUTH_SECRET: 'sneaky',
        DATABASE_URL: 'postgresql://evil',
      },
    };
    const result = await run({ section: 'modules', events: false }, db);
    expect(result).toEqual({ ok: true, changed: true });
    expect(JSON.stringify(state.row)).not.toContain('sneaky');
    expect(JSON.stringify(state.row)).not.toContain('evil');
  });
});

describe('the contact address', () => {
  const identity = {
    section: 'identity',
    name: 'BDE Test',
    accentColor: '#0f766e',
    messageLocale: 'fr',
  } as const;

  it('is saved, trimmed, and shown in the audit as changed', async () => {
    const { db, state } = fakeDb();
    expect(await run({ ...identity, contactEmail: ' bureau@exemple.fr ' }, db)).toEqual({
      ok: true,
      changed: true,
    });
    expect((state.row?.config as BdeConfig).bde.contactEmail).toBe('bureau@exemple.fr');
    expect(state.audit[0]?.metadata).toMatchObject({
      contactEmail: { from: null, to: 'bureau@exemple.fr' },
    });
  });

  it('is kept when the change does not mention it, and removed when it is blank', async () => {
    const config = baseConfig();
    config.bde.contactEmail = 'bureau@exemple.fr';
    const { db, state } = fakeDb({ config });

    expect(await run({ ...identity, name: 'Autre nom' }, db)).toMatchObject({ ok: true });
    expect((state.row?.config as BdeConfig).bde.contactEmail).toBe('bureau@exemple.fr');

    expect(await run({ ...identity, name: 'Autre nom', contactEmail: '  ' }, db)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect((state.row?.config as BdeConfig).bde).not.toHaveProperty('contactEmail');
  });

  it('is refused when it is not an address, and nothing is written', async () => {
    const { db, state } = fakeDb();
    expect(await run({ ...identity, contactEmail: 'pas une adresse' }, db)).toMatchObject({
      ok: false,
      code: 'email',
      field: 'contactEmail',
    });
    expect(state.audit).toEqual([]);
  });
});

describe('the logo', () => {
  it('can be an uploaded one, then the default one again, and each is audited', async () => {
    const { db, state } = fakeDb();
    expect(await run({ section: 'logo', logoPath: '/api/logo?v=0123456789abcdef' }, db)).toEqual({
      ok: true,
      changed: true,
    });
    expect((state.row?.config as BdeConfig).bde.logoPath).toBe('/api/logo?v=0123456789abcdef');
    expect(getRuntimeSettings()?.config.bde.logoPath).toBe('/api/logo?v=0123456789abcdef');

    await run({ section: 'logo', logoPath: '/logo.svg' }, db);
    expect((state.row?.config as BdeConfig).bde.logoPath).toBe('/logo.svg');
    expect(state.audit.map((entry) => [entry.action, entry.metadata])).toEqual([
      ['settings.logo.update', { from: 'default', to: 'uploaded' }],
      ['settings.logo.update', { from: 'uploaded', to: 'default' }],
    ]);
  });

  it.each([
    '/etc/passwd',
    'https://elsewhere.example/logo.png',
    '/api/logo?v=../../x',
    '/public/x.png',
    '',
  ])('refuses %j: only the default logo or an uploaded one', async (logoPath) => {
    const { db, state } = fakeDb();
    expect(await run({ section: 'logo', logoPath }, db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(state.audit).toEqual([]);
  });
});

describe('the events settings', () => {
  const cat = (key: string | undefined, label: string, color = '#db2777') => ({
    key,
    label,
    color,
  });
  const events = (change: Partial<Extract<SettingsChange, { section: 'events' }>> = {}) =>
    ({
      section: 'events',
      categories: [cat('soiree', 'Soirée')],
      reminderHour: 18,
      ...change,
    }) as SettingsChange;
  const twoCategories = () =>
    baseConfig({
      events: {
        categories: [
          { key: 'soiree', label: 'Soirée', color: '#db2777' },
          { key: 'sport', label: 'Sport', color: '#16a34a' },
        ],
        reminderHour: 18,
        intraPublication: false,
      },
    });

  it('adds a category: its key is made from its name, and never changes afterwards', async () => {
    const { db, state } = fakeDb();
    const result = await run(
      events({
        categories: [cat('soiree', 'Soirée'), cat(undefined, 'Soirée de rentrée', '#ABC')],
      }),
      db,
    );
    expect(result).toEqual({ ok: true, changed: true });
    expect((state.row?.config as BdeConfig).events?.categories).toEqual([
      { key: 'soiree', label: 'Soirée', color: '#db2777' },
      { key: 'soiree-de-rentree', label: 'Soirée de rentrée', color: '#aabbcc' },
    ]);
    expect(getRuntimeSettings()?.config.events?.categories).toHaveLength(2);
    expect(state.audit[0]).toMatchObject({
      action: 'settings.events.update',
      metadata: { added: ['Soirée de rentrée'], removed: [] },
    });
  });

  it('gives a new category a key of its own even when its name is that of another', async () => {
    const { db, state } = fakeDb();
    await run(events({ categories: [cat('soiree', 'Soirée'), cat(undefined, 'SOIREE!')] }), db);
    await run(
      events({
        categories: [
          cat('soiree', 'Soirée'),
          cat('soiree-2', 'SOIREE!'),
          cat(undefined, 'soirée ?'),
        ],
      }),
      db,
    );
    const keys = (state.row?.config as BdeConfig).events?.categories.map((c) => c.key);
    expect(keys).toEqual(['soiree', 'soiree-2', 'soiree-3']);
  });

  it('renames and recolours without touching the key (the events keep their category)', async () => {
    const { db, state } = fakeDb({ events: [{ id: 'e1', categoryKey: 'soiree' }] });
    await run(events({ categories: [cat('soiree', 'Fête', '#000000')] }), db);
    expect((state.row?.config as BdeConfig).events?.categories).toEqual([
      { key: 'soiree', label: 'Fête', color: '#000000' },
    ]);
    expect(state.events).toEqual([{ id: 'e1', categoryKey: 'soiree' }]);
    expect(state.audit[0]?.metadata).toMatchObject({
      renamed: [{ from: 'Soirée', to: 'Fête' }],
      recolored: ['Fête'],
    });
  });

  it('changes the hour of the reminder, at once', async () => {
    const { db, state } = fakeDb();
    await run(events({ reminderHour: 9 }), db);
    expect((state.row?.config as BdeConfig).events?.reminderHour).toBe(9);
    expect(getRuntimeSettings()?.config.events?.reminderHour).toBe(9);
    expect(state.audit[0]?.metadata).toMatchObject({ reminderHour: { from: 18, to: 9 } });
  });

  it('turns the publication on the intra on and off, at once, and says so in the audit log', async () => {
    const { db, state } = fakeDb();
    expect(getRuntimeSettings()?.config.events?.intraPublication ?? false).toBe(false);

    await run(events({ intraPublication: true }), db);
    expect((state.row?.config as BdeConfig).events?.intraPublication).toBe(true);
    expect(getRuntimeSettings()?.config.events?.intraPublication).toBe(true);
    expect(state.audit[0]?.metadata).toMatchObject({ intraPublication: { from: false, to: true } });

    await run(events({ intraPublication: false }), db);
    expect(getRuntimeSettings()?.config.events?.intraPublication).toBe(false);
  });

  it('keeps the publication on the intra as it is when the change does not mention it', async () => {
    const { db, state } = fakeDb();
    await run(events({ intraPublication: true }), db);
    await run(events({ reminderHour: 9 }), db);
    expect((state.row?.config as BdeConfig).events).toMatchObject({
      reminderHour: 9,
      intraPublication: true,
    });
  });

  it('refuses a publication setting that is not a boolean', async () => {
    const { db, state } = fakeDb();
    expect(await run(events({ intraPublication: 'yes' as unknown as boolean }), db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(state.audit).toEqual([]);
  });

  it.each([-1, 24, 1.5, Number.NaN])('refuses %s as an hour', async (reminderHour) => {
    const { db, state } = fakeDb();
    expect(await run(events({ reminderHour }), db)).toMatchObject({
      ok: false,
      code: 'reminderHour',
    });
    expect(state.audit).toEqual([]);
  });

  it('takes out a category no event uses', async () => {
    const { db, state } = fakeDb({ config: twoCategories() });
    expect(await run(events(), db)).toMatchObject({ ok: true, changed: true });
    expect((state.row?.config as BdeConfig).events?.categories.map((c) => c.key)).toEqual([
      'soiree',
    ]);
    expect(state.audit[0]?.metadata).toMatchObject({ removed: [{ label: 'Sport', events: 0 }] });
  });

  it('refuses to take out a category events still use, and changes nothing', async () => {
    const { db, state } = fakeDb({
      config: twoCategories(),
      events: [
        { id: 'e1', categoryKey: 'sport' },
        { id: 'e2', categoryKey: 'sport' },
      ],
    });
    expect(await run(events(), db)).toMatchObject({
      ok: false,
      code: 'categoryInUse',
      detail: 'Sport',
    });
    expect((state.row?.config as BdeConfig).events?.categories).toHaveLength(2);
    expect(state.events.map((e) => e.categoryKey)).toEqual(['sport', 'sport']);
    expect(state.audit).toEqual([]);
  });

  it('moves the events of a category taken out to the one chosen, in the same transaction, and says how many', async () => {
    const { db, state } = fakeDb({
      config: twoCategories(),
      events: [
        { id: 'e1', categoryKey: 'sport' },
        { id: 'e2', categoryKey: 'sport' },
        { id: 'e3', categoryKey: 'soiree' },
      ],
    });
    expect(await run(events({ reassign: { sport: 'soiree' } }), db)).toMatchObject({ ok: true });
    expect(state.events.map((e) => e.categoryKey)).toEqual(['soiree', 'soiree', 'soiree']);
    expect(state.audit[0]?.metadata).toMatchObject({
      removed: [{ label: 'Sport', events: 2, movedTo: 'Soirée' }],
    });
  });

  it('does not move events to a category that is going too, nor to one that does not exist', async () => {
    const { db, state } = fakeDb({
      config: twoCategories(),
      events: [{ id: 'e1', categoryKey: 'sport' }],
    });
    expect(await run(events({ reassign: { sport: 'sport' } }), db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await run(events({ reassign: { sport: 'nothing' } }), db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(state.events[0]?.categoryKey).toBe('sport');
  });

  it('applies the move once when the write loses against another save and is retried', async () => {
    const { db, state } = fakeDb({
      config: twoCategories(),
      events: [{ id: 'e1', categoryKey: 'sport' }],
    });
    state.beforeWrite = () => {
      state.row = { ...state.row, updatedAt: new Date('2026-10-01T10:30:00Z') };
    };
    expect(await run(events({ reassign: { sport: 'soiree' } }), db)).toMatchObject({ ok: true });
    expect(state.events[0]?.categoryKey).toBe('soiree');
    expect(state.audit).toHaveLength(1);
  });

  it.each([
    ['no category at all', { categories: [] }, 'categoryLast'],
    ['an empty name', { categories: [cat('soiree', '   ')] }, 'categoryLabel'],
    ['a name of 41 characters', { categories: [cat('soiree', 'x'.repeat(41))] }, 'categoryLabel'],
    ['a bad colour', { categories: [cat('soiree', 'Soirée', 'rouge')] }, 'color'],
    [
      'two categories of the same name',
      { categories: [cat('soiree', 'Fête'), cat(undefined, 'fête')] },
      'categoryDuplicate',
    ],
    ['a key nobody knows', { categories: [cat('mystery', 'Autre')] }, 'invalid'],
    ['the same key twice', { categories: [cat('soiree', 'A'), cat('soiree', 'B')] }, 'invalid'],
    [
      'more than 30 categories',
      { categories: Array.from({ length: 31 }, (_, i) => cat(undefined, `Catégorie ${i}`)) },
      'tooManyCategories',
    ],
  ])('refuses %s', async (_what, change, code) => {
    const { db, state } = fakeDb();
    expect(await run(events(change), db)).toMatchObject({ ok: false, code });
    expect(state.audit).toEqual([]);
    expect((state.row?.config as BdeConfig).events?.categories).toHaveLength(1);
  });

  it('is refused while the events module is off', async () => {
    const config = baseConfig({ modules: { enabled: [] } });
    const { db } = fakeDb({ config });
    expect(await run(events(), db)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('the staff room', () => {
  const discord = 'https://discord.com/api/webhooks/987654321/staff-secret';
  const slack = 'https://hooks.slack.com/services/T0123/B0456/staffsecret';
  const staff = (change: Partial<Extract<SettingsChange, { section: 'staff-channel' }>> = {}) =>
    ({
      section: 'staff-channel',
      discordWebhook: '',
      slackWebhook: '',
      ...change,
    }) as SettingsChange;
  /** What the row holds, sealed, once opened. */
  const stored = (state: { row: Record<string, unknown> | null }) =>
    unseal(String(state.row?.secrets), settingsKey()) as Record<string, string>;

  it('saves the addresses typed, sealed, and loads them at once', async () => {
    const { db, state } = fakeDb();
    expect(await run(staff({ discordWebhook: discord, slackWebhook: slack }), db)).toEqual({
      ok: true,
      changed: true,
    });
    expect(stored(state)).toMatchObject({
      DISCORD_STAFF_WEBHOOK_URL: discord,
      SLACK_STAFF_WEBHOOK_URL: slack,
    });
    expect(setting('DISCORD_STAFF_WEBHOOK_URL')).toBe(discord);
    // the BDE's own channels are another thing and are not touched
    expect(stored(state).DISCORD_WEBHOOK_URL).toBeUndefined();
  });

  it('audits which secret changed, never what it is', async () => {
    const { db, state } = fakeDb();
    await run(staff({ discordWebhook: discord }), db);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: 'settings.staff-channel.update',
      metadata: { changedSecrets: ['DISCORD_STAFF_WEBHOOK_URL'] },
    });
    expect(JSON.stringify(state.audit)).not.toContain('staff-secret');
  });

  it('keeps a saved address when the field is left blank, and writes nothing when nothing changes', async () => {
    const { db, state } = fakeDb({
      values: { ...baseValues, DISCORD_STAFF_WEBHOOK_URL: discord },
    });
    expect(await run(staff(), db)).toEqual({ ok: true, changed: false });
    expect(stored(state).DISCORD_STAFF_WEBHOOK_URL).toBe(discord);
    expect(state.audit).toEqual([]);
  });

  it('replaces an address by another, and forgets one that is removed (what was typed for it is ignored)', async () => {
    const { db, state } = fakeDb({
      values: { ...baseValues, DISCORD_STAFF_WEBHOOK_URL: discord, SLACK_STAFF_WEBHOOK_URL: slack },
    });
    const other = 'https://discord.com/api/webhooks/111222333/another';
    await run(staff({ discordWebhook: other, removeSlack: true, slackWebhook: 'garbage' }), db);
    expect(stored(state).DISCORD_STAFF_WEBHOOK_URL).toBe(other);
    expect(stored(state).SLACK_STAFF_WEBHOOK_URL).toBeUndefined();
    expect(state.audit[0]?.metadata).toMatchObject({
      changedSecrets: ['DISCORD_STAFF_WEBHOOK_URL', 'SLACK_STAFF_WEBHOOK_URL'],
    });
  });

  it.each([
    [
      'a Discord address that is another site',
      { discordWebhook: 'https://evil.example/api/webhooks/1/x' },
      'discord',
      'discordWebhook',
    ],
    [
      'a Discord address over http',
      { discordWebhook: 'http://discord.com/api/webhooks/1/x' },
      'discord',
      'discordWebhook',
    ],
    [
      'a Slack address that is not a hook',
      { slackWebhook: 'https://hooks.slack.com/other' },
      'slack',
      'slackWebhook',
    ],
  ] as const)(
    'refuses %s, on its field, and changes nothing',
    async (_what, change, code, field) => {
      const { db, state } = fakeDb();
      const before = { ...state.row };
      expect(await run(staff(change), db)).toMatchObject({ ok: false, code, field });
      expect(state.audit).toEqual([]);
      expect(state.row).toEqual(before);
    },
  );

  it('is refused when the events module is off, and for what is not a string', async () => {
    const off = fakeDb({ config: baseConfig({ modules: { enabled: [] } }) });
    expect(await run(staff({ discordWebhook: discord }), off.db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    const { db } = fakeDb();
    expect(await run(staff({ discordWebhook: 3 as unknown as string }), db)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeConfigSchema, type BdeConfig } from '@/config/schema';
import { seal, settingsKey } from './crypto';
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
  options: { config?: BdeConfig; values?: SettingValues; accounts?: Account[] } = {},
) {
  const config = options.config ?? baseConfig();
  const values = options.values ?? baseValues;
  const secretNames = [
    'FORTYTWO_CLIENT_SECRET',
    'SMTP_PASSWORD',
    'DISCORD_WEBHOOK_URL',
    'SLACK_WEBHOOK_URL',
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

  describe('notifications', () => {
    const discord = 'https://discord.com/api/webhooks/123456789/secret-part';

    it('choose a channel for every notification, keep the webhook sealed, and audit only that it changed', async () => {
      const { db, state } = fakeDb();
      expect(
        await run(
          { section: 'notifications', notifications: { mode: 'discord', discordWebhook: discord } },
          db,
        ),
      ).toEqual({ ok: true, changed: true });

      expect(getRuntimeSettings()?.config.notifications).toEqual({
        memberPending: 'discord',
        memberApproved: 'discord',
        memberRemoved: 'discord',
        eventConfirmed: 'discord',
        eventReminder: 'discord',
      });
      expect(setting('DISCORD_WEBHOOK_URL')).toBe(discord);
      expect(state.audit[0]?.metadata).toEqual({
        channel: { from: 'none', to: 'discord' },
        changedSecrets: ['DISCORD_WEBHOOK_URL'],
      });
      expect(JSON.stringify([state.audit, state.row])).not.toContain('secret-part');
    });

    it('keep what was saved for a channel that is not chosen, so that switching back finds it', async () => {
      const { db } = fakeDb();
      await run(
        { section: 'notifications', notifications: { mode: 'discord', discordWebhook: discord } },
        db,
      );
      await run({ section: 'notifications', notifications: { mode: 'none' } }, db);
      expect(setting('DISCORD_WEBHOOK_URL')).toBe(discord);
      // …and a blank field keeps it
      expect(
        await run(
          { section: 'notifications', notifications: { mode: 'discord', discordWebhook: '' } },
          db,
        ),
      ).toEqual({ ok: true, changed: true });
      expect(getRuntimeSettings()?.config.notifications.eventConfirmed).toBe('discord');
    });

    it('refuse a channel whose settings are missing or wrong, and send nothing for the removal over e-mail', async () => {
      const { db } = fakeDb();
      expect(
        await run(
          { section: 'notifications', notifications: { mode: 'slack', slackWebhook: '' } },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'slack' });
      expect(
        await run(
          {
            section: 'notifications',
            notifications: {
              mode: 'email',
              smtp: { host: 'bad host', port: '587', user: '', password: '', from: 'a@b.fr' },
            },
          },
          db,
        ),
      ).toMatchObject({ ok: false, code: 'smtpHost' });
      await run(
        {
          section: 'notifications',
          notifications: {
            mode: 'email',
            smtp: {
              host: 'smtp.exemple.fr',
              port: '587',
              user: 'bde',
              password: 'p4ss',
              from: 'bde@exemple.fr',
            },
          },
        },
        db,
      );
      expect(getRuntimeSettings()?.config.notifications.memberRemoved).toBe('none');
      expect(getRuntimeSettings()?.config.notifications.memberPending).toBe('email');
      expect(setting('SMTP_PASSWORD')).toBe('p4ss');
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
          mode: 'email',
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

// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeConfigSchema, type BdeConfig } from '@/config/schema';
import { seal, settingsKey } from './crypto';
import { getRuntimeConfig, getRuntimeSettings, setRuntimeSettings, setting } from './runtime';

const loadConfigFile = vi.hoisted(() => vi.fn());
vi.mock('@/config', async () => {
  class ConfigError extends Error {}
  return { ConfigError, loadConfigFile };
});
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { initializePlatform, PlatformSettingsError, settingValuesFrom, splitSettings } =
  await import('./store');
const { ConfigError } = await import('@/config');

const configWith = (owners: string[]): BdeConfig =>
  bdeConfigSchema.parse({
    bde: {
      name: 'BDE Test',
      campus: 'Paris',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#0f766e',
      logoPath: '/logo.svg',
    },
    auth: { owners, allowedCampuses: ['Paris'] },
    modules: { enabled: [] },
    notifications: { memberPending: 'none', memberApproved: 'none', memberRemoved: 'none' },
  });

const COMPLETE_ENV = {
  AUTH_SECRET: 'x'.repeat(44),
  DATABASE_URL: 'postgresql://bde:pw@postgres:5432/bde_network?schema=public',
  FORTYTWO_CLIENT_ID: 'u-s4t2ud-abc',
  FORTYTWO_CLIENT_SECRET: 'the-42-secret-value',
  APP_URL: 'https://bde.example.fr',
  SMTP_HOST: 'smtp.example.fr',
  SMTP_PASSWORD: 'the-smtp-password',
};

interface Row {
  id: string;
  config: unknown;
  environment: unknown;
  secrets: string | null;
  source: string;
  installedAt: Date;
}

/** A database with one table, behaving like Prisma for what the store uses. */
function fakeDb(initial?: Row) {
  let row = initial;
  const platformSettings = {
    findUnique: vi.fn(async () => row ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (row) throw Object.assign(new Error('unique'), { code: 'P2002' });
      row = data;
    }),
    update: vi.fn(async ({ data }: { data: Partial<Row> }) => {
      row = { ...(row as Row), ...data };
    }),
  };
  return { db: { platformSettings } as never, platformSettings, current: () => row };
}

const logger = () => ({ log: vi.fn(), warn: vi.fn() });

describe('the settings store', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    setRuntimeSettings(undefined);
    loadConfigFile.mockReset();
    Object.assign(process.env, COMPLETE_ENV);
    delete process.env.SETTINGS_KEY;
  });
  afterEach(() => {
    setRuntimeSettings(undefined);
    process.env = { ...saved };
  });

  describe('settingValuesFrom / splitSettings', () => {
    it('keeps only the managed settings, blank ones out', () => {
      expect(
        settingValuesFrom({
          APP_URL: ' https://a.fr ',
          SMTP_HOST: '  ',
          AUTH_SECRET: 'x',
          PATH: '/bin',
        }),
      ).toEqual({ APP_URL: 'https://a.fr' });
    });

    it('puts the secrets apart from the rest', () => {
      expect(
        splitSettings({
          APP_URL: 'https://a.fr',
          FORTYTWO_CLIENT_ID: 'id',
          FORTYTWO_CLIENT_SECRET: 'secret',
          SLACK_WEBHOOK_URL: 'https://hooks',
        }),
      ).toEqual({
        environment: { APP_URL: 'https://a.fr', FORTYTWO_CLIENT_ID: 'id' },
        secrets: { FORTYTWO_CLIENT_SECRET: 'secret', SLACK_WEBHOOK_URL: 'https://hooks' },
      });
    });
  });

  describe('an installation that predates the table', () => {
    it('copies bde.config.yml and .env into the database, the secrets sealed', async () => {
      loadConfigFile.mockReturnValue({ config: configWith(['alice']), filename: 'bde.config.yml' });
      const { db, current } = fakeDb();
      const log = logger();

      expect(await initializePlatform(db, log)).toEqual({ source: 'import' });

      const row = current() as Row;
      expect(row.source).toBe('import');
      expect(row.environment).toEqual({
        APP_URL: 'https://bde.example.fr',
        FORTYTWO_CLIENT_ID: 'u-s4t2ud-abc',
        SMTP_HOST: 'smtp.example.fr',
      });
      // nothing secret anywhere in clear in what the database holds
      const everything = JSON.stringify(row);
      expect(everything).not.toContain('the-42-secret-value');
      expect(everything).not.toContain('the-smtp-password');
      expect(row.secrets?.startsWith('v1.')).toBe(true);

      expect(getRuntimeConfig()?.auth.owners).toEqual(['alice']);
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('the-42-secret-value');
      expect(log.log).toHaveBeenCalledWith(
        expect.stringContaining('copiés dans la base de données'),
      );
    });

    it('does not import the template (the placeholder owner means nothing was decided)', async () => {
      loadConfigFile.mockReturnValue({
        config: configWith(['votre-login-42']),
        filename: 'bde.config.yml',
      });
      const { db, current } = fakeDb();
      expect(await initializePlatform(db, logger())).toEqual({ source: 'files' });
      expect(current()).toBeUndefined();
      expect(getRuntimeSettings()).toBeUndefined();
    });

    it('does not import an incomplete .env: the start-up checks report it, as before', async () => {
      loadConfigFile.mockReturnValue({ config: configWith(['alice']), filename: 'bde.config.yml' });
      delete process.env.FORTYTWO_CLIENT_SECRET;
      const { db, current } = fakeDb();
      expect(await initializePlatform(db, logger())).toEqual({ source: 'files' });
      expect(current()).toBeUndefined();
    });

    it('leaves an unusable bde.config.yml to the start-up checks', async () => {
      loadConfigFile.mockImplementation(() => {
        throw new ConfigError('bde.config.yml est vide');
      });
      const { db } = fakeDb();
      expect(await initializePlatform(db, logger())).toEqual({ source: 'files' });
    });

    it('lets any other error through', async () => {
      loadConfigFile.mockImplementation(() => {
        throw new TypeError('a bug');
      });
      await expect(initializePlatform(fakeDb().db, logger())).rejects.toThrow('a bug');
    });

    it('takes what another process wrote when both import at the same moment', async () => {
      loadConfigFile.mockReturnValue({ config: configWith(['alice']), filename: 'bde.config.yml' });
      const other = fakeDb();
      other.platformSettings.findUnique
        .mockResolvedValueOnce(null) // nothing yet...
        .mockResolvedValue({
          id: 'platform',
          config: configWith(['bob']),
          environment: { APP_URL: 'https://other.example' },
          secrets: null,
          source: 'import',
          installedAt: new Date(),
        }); // ...then the other process's row
      other.platformSettings.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      expect(await initializePlatform(other.db, logger())).toEqual({ source: 'database' });
      expect(getRuntimeConfig()?.auth.owners).toEqual(['bob']);
    });
  });

  describe('an installed platform', () => {
    const rowWith = (secrets: Record<string, string> | null, key = settingsKey()): Row => ({
      id: 'platform',
      config: configWith(['alice']),
      environment: { APP_URL: 'https://from-database.example', FORTYTWO_CLIENT_ID: 'id-db' },
      secrets: secrets ? seal(secrets, key) : null,
      source: 'import',
      installedAt: new Date(),
    });

    it('loads the row and nothing from the files', async () => {
      const { db } = fakeDb(rowWith({ FORTYTWO_CLIENT_SECRET: 'secret-from-database' }));
      expect(await initializePlatform(db, logger())).toEqual({ source: 'database' });

      expect(setting('APP_URL')).toBe('https://from-database.example');
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('secret-from-database');
      expect(setting('SMTP_HOST')).toBeUndefined(); // still in .env, not in the database: ignored
      expect(loadConfigFile).not.toHaveBeenCalled();
    });

    it('ignores what the row holds that is not a managed setting', async () => {
      const row = rowWith({ FORTYTWO_CLIENT_SECRET: 's', AUTH_SECRET: 'sneaky' });
      row.environment = { APP_URL: 'https://a.fr', DATABASE_URL: 'postgresql://evil' };
      await initializePlatform(fakeDb(row).db, logger());
      expect(Object.keys(getRuntimeSettings()?.values ?? {}).sort()).toEqual([
        'APP_URL',
        'FORTYTWO_CLIENT_SECRET',
      ]);
    });

    it('refuses to start, with a French explanation, when the stored configuration is invalid', async () => {
      const row = rowWith(null);
      row.config = { bde: { name: '' } };
      await expect(initializePlatform(fakeDb(row).db, logger())).rejects.toThrow(
        PlatformSettingsError,
      );
      await expect(initializePlatform(fakeDb(row).db, logger())).rejects.toThrow(/sauvegarde/);
      expect(getRuntimeSettings()).toBeUndefined();
    });

    it('survives a lost `secrets` volume by taking the secrets of .env again, and seals them with the new key', async () => {
      const lostKey = randomBytes(32);
      const { db, current, platformSettings } = fakeDb(
        rowWith({ FORTYTWO_CLIENT_SECRET: 'old-secret' }, lostKey),
      );
      const log = logger();

      await initializePlatform(db, log);

      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('the-42-secret-value'); // from .env
      expect(setting('SMTP_PASSWORD')).toBe('the-smtp-password');
      expect(setting('APP_URL')).toBe('https://from-database.example'); // not secret: from the row
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('volume « secrets »'));
      expect(platformSettings.update).toHaveBeenCalledTimes(1);
      expect((current() as Row).secrets).not.toContain('the-42-secret-value');

      // and the next start reads them with the new key, without a warning
      const next = logger();
      setRuntimeSettings(undefined);
      await initializePlatform(fakeDb(current()).db, next);
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('the-42-secret-value');
      expect(next.warn).not.toHaveBeenCalled();
    });

    it('starts with no secret, and says so, when the volume is lost and .env has none', async () => {
      delete process.env.FORTYTWO_CLIENT_SECRET;
      delete process.env.SMTP_PASSWORD;
      const { db, platformSettings } = fakeDb(
        rowWith({ FORTYTWO_CLIENT_SECRET: 'old' }, randomBytes(32)),
      );
      const log = logger();

      await initializePlatform(db, log);

      expect(setting('FORTYTWO_CLIENT_SECRET')).toBeUndefined();
      expect(log.warn).toHaveBeenCalled();
      expect(platformSettings.update).not.toHaveBeenCalled(); // nothing to reseal: the row is left as it is
    });
  });

  describe('BDE_REIMPORT=1', () => {
    const installed = (): Row => ({
      id: 'platform',
      config: configWith(['alice']),
      environment: { APP_URL: 'https://from-database.example' },
      secrets: seal({ FORTYTWO_CLIENT_SECRET: 'secret-from-database' }, settingsKey()),
      source: 'installer',
      installedAt: new Date(),
    });

    afterEach(() => {
      delete process.env.BDE_REIMPORT;
    });

    it('is not looked at unless it is set: the files of an installed platform are not read', async () => {
      loadConfigFile.mockReturnValue({ config: configWith(['bob']), filename: 'bde.config.yml' });
      const { db, platformSettings } = fakeDb(installed());
      await initializePlatform(db, logger());
      expect(loadConfigFile).not.toHaveBeenCalled();
      expect(platformSettings.update).not.toHaveBeenCalled();
      expect(getRuntimeConfig()?.auth.owners).toEqual(['alice']);
    });

    it('replaces the settings of the database by the files, and says to remove the variable', async () => {
      process.env.BDE_REIMPORT = '1';
      loadConfigFile.mockReturnValue({ config: configWith(['bob']), filename: 'bde.config.yml' });
      const { db, current } = fakeDb(installed());
      const log = logger();

      await initializePlatform(db, log);

      expect(getRuntimeConfig()?.auth.owners).toEqual(['bob']);
      expect(setting('FORTYTWO_CLIENT_SECRET')).toBe('the-42-secret-value');
      expect(setting('APP_URL')).toBe('https://bde.example.fr');
      expect((current() as Row).source).toBe('import');
      expect(JSON.stringify(current())).not.toContain('the-42-secret-value');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Retirez cette variable'));
    });

    it('is ignored, and says why, when the files are not complete: the database is kept', async () => {
      process.env.BDE_REIMPORT = '1';
      loadConfigFile.mockReturnValue({ config: configWith(['bob']), filename: 'bde.config.yml' });
      delete process.env.FORTYTWO_CLIENT_SECRET;
      const { db, platformSettings } = fakeDb(installed());
      const log = logger();

      await initializePlatform(db, log);

      expect(platformSettings.update).not.toHaveBeenCalled();
      expect(getRuntimeConfig()?.auth.owners).toEqual(['alice']);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('BDE_REIMPORT=1 est ignoré'));
    });

    it('is ignored when bde.config.yml is the unfilled template', async () => {
      process.env.BDE_REIMPORT = '1';
      loadConfigFile.mockReturnValue({
        config: configWith(['votre-login-42']),
        filename: 'bde.config.yml',
      });
      const { db, platformSettings } = fakeDb(installed());
      await initializePlatform(db, logger());
      expect(platformSettings.update).not.toHaveBeenCalled();
    });
  });
});

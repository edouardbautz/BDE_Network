import type { BdeConfig } from '@/config/schema';

/**
 * The platform's settings as the running process sees them.
 *
 * They used to come from two files read at start-up (bde.config.yml and .env). They now live in the
 * database (`PlatformSettings`, see store.ts) and are loaded into this cache when the server starts and
 * whenever they change, so that the 35 places that read the configuration stay synchronous and a change
 * applies at once, with no rebuild and no restart.
 *
 * While nothing has been loaded (an installation that has not been imported yet, `npm run dev`, the
 * tests) every reader falls back on the files and on `process.env`, exactly as before.
 *
 * The cache sits on `globalThis`: Next.js bundles the instrumentation hook and the pages separately, and a
 * plain module variable would then exist twice.
 */

/** The variables of .env that the platform manages itself once it is installed. */
export const SETTING_KEYS = [
  'APP_URL',
  'FORTYTWO_CLIENT_ID',
  'FORTYTWO_CLIENT_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Those that are secrets: sealed in the database, never logged, never sent to the browser. */
export const SECRET_SETTING_KEYS = [
  'FORTYTWO_CLIENT_SECRET',
  'SMTP_PASSWORD',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
] as const satisfies readonly SettingKey[];

export type SettingValues = Partial<Record<SettingKey, string>>;

export function isSettingKey(name: string): name is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(name);
}

export function isSecretSettingKey(name: string): boolean {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(name);
}

export interface RuntimeSettings {
  config: BdeConfig;
  values: SettingValues;
  /** "database" once the platform has been loaded from its settings row. */
  source: 'database';
  /**
   * What became of the sealed secrets at start-up: readable (`ok`), unreadable but taken again from .env
   * (`resealed`), or unreadable and gone (`lost`: the `secrets` volume was replaced). The settings page says so.
   */
  secretsStatus?: 'ok' | 'resealed' | 'lost';
}

const SLOT = Symbol.for('bde-network.runtime-settings');
type Holder = typeof globalThis & { [SLOT]?: RuntimeSettings };

export function getRuntimeSettings(): RuntimeSettings | undefined {
  return (globalThis as Holder)[SLOT];
}

export function setRuntimeSettings(settings: RuntimeSettings | undefined): void {
  (globalThis as Holder)[SLOT] = settings;
}

/** The configuration of the BDE, when it was loaded from the database. */
export function getRuntimeConfig(): BdeConfig | undefined {
  return getRuntimeSettings()?.config;
}

/**
 * One setting: from the database once the platform is loaded from it (a stale variable of .env is then
 * ignored on purpose), from the environment before. Blank counts as not set.
 */
export function setting(key: SettingKey): string | undefined {
  const runtime = getRuntimeSettings();
  const value = runtime ? runtime.values[key] : process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

/**
 * The environment the checks of `.env` should look at: the real one, in which the settings that the
 * database manages are replaced by the database's.
 */
export function effectiveEnvironment(
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const runtime = getRuntimeSettings();
  if (!runtime) return { ...base };
  const environment: Record<string, string | undefined> = { ...base };
  for (const key of SETTING_KEYS) delete environment[key];
  return { ...environment, ...runtime.values };
}

import { ConfigError, loadConfigFile } from '@/config';
import { PLACEHOLDER_OWNER, validateEnvironment } from '@/config/env';
import { bdeConfigSchema, type BdeConfig } from '@/config/schema';
import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { seal, settingsKey, SettingsDecryptError, unseal } from './crypto';
import {
  SETTING_KEYS,
  isSecretSettingKey,
  setRuntimeSettings,
  type SettingKey,
  type SettingValues,
} from './runtime';

/**
 * The platform's settings in the database (`PlatformSettings`): loading them when the server starts, and
 * bringing in an installation that predates them.
 *
 * Until now the configuration was two files read at start-up, bde.config.yml and .env. Both are read ONCE
 * more, at the first start after the update: when they are complete, their content is copied into the
 * database (the secrets sealed, see crypto.ts) and the platform is "installed". From then on the database
 * is the only source; the two files are not read any more.
 */

export const PLATFORM_ID = 'platform';

/** The stored settings cannot be used: the server refuses to start and says why. */
export class PlatformSettingsError extends Error {}

type SettingsDb = Pick<PrismaClient, 'platformSettings'>;

export type InitializeResult =
  /** Loaded from the settings row. */
  | { source: 'database' }
  /** Copied from bde.config.yml and .env just now, then loaded. */
  | { source: 'import' }
  /** Nothing in the database and the files are not complete: the platform runs from the files, as before. */
  | { source: 'files' }
  /** Nothing in the database and nothing decided in the files (the unfilled template): to be installed from the browser. */
  | { source: 'setup' };

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

/** The managed settings that .env holds, blank ones left out. */
export function settingValuesFrom(env: Record<string, string | undefined>): SettingValues {
  const values: SettingValues = {};
  for (const key of SETTING_KEYS) {
    const value = env[key]?.trim();
    if (value) values[key] = value;
  }
  return values;
}

/** Splits the settings into what the row keeps in clear and what is sealed. */
export function splitSettings(values: SettingValues): {
  environment: Record<string, string>;
  secrets: Record<string, string>;
} {
  const environment: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    (isSecretSettingKey(key) ? secrets : environment)[key] = value;
  }
  return { environment, secrets };
}

const asStrings = (value: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') result[key] = entry;
    }
  }
  return result;
};

/** The values the database manages, whatever the row happens to hold. */
const managed = (values: Record<string, string>): SettingValues => {
  const result: SettingValues = {};
  for (const key of SETTING_KEYS) {
    const value = values[key];
    if (value) result[key as SettingKey] = value;
  }
  return result;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

async function loadFromRow(
  db: SettingsDb,
  row: { config: unknown; environment: unknown; secrets: string | null },
  logger: Logger,
): Promise<void> {
  const parsed = bdeConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PlatformSettingsError(
      [
        'Les réglages enregistrés dans la base de données sont invalides :',
        `  ${first ? `${first.path.join('.') || '(racine)'} : ${first.message}` : 'format inconnu'}`,
        '',
        'Ils ne sont pas modifiables à la main : restaurez la dernière sauvegarde de la base de données',
        '(docs/deployment.md, « Sauvegardes et restauration »).',
      ].join('\n'),
    );
  }

  let secrets: Record<string, string> = {};
  let secretsStatus: 'ok' | 'resealed' | 'lost' = 'ok';
  if (row.secrets) {
    const key = settingsKey();
    try {
      secrets = unseal(row.secrets, key);
    } catch (error) {
      if (!(error instanceof SettingsDecryptError)) throw error;
      // Not the key that sealed them: the `secrets` volume was lost, or replaced by another. The .env of
      // the installation, if it is still there, is the way back; if it is not, the checks that follow
      // name what is missing.
      secrets = splitSettings(settingValuesFrom(process.env)).secrets;
      logger.warn(
        '\n⚠️  Les secrets enregistrés (clé 42, mot de passe SMTP, webhooks) ne peuvent pas être déchiffrés :\n' +
          '    le volume « secrets » de Docker a été perdu ou remplacé. Restaurez-le avec la sauvegarde\n' +
          '    des secrets (scripts/restore.sh --secrets), ou remettez ces valeurs dans .env.\n',
      );
      secretsStatus = Object.keys(secrets).length > 0 ? 'resealed' : 'lost';
      if (Object.keys(secrets).length > 0) {
        await db.platformSettings.update({
          where: { id: PLATFORM_ID },
          data: { secrets: seal(secrets, key) },
        });
        logger.log('    Les secrets présents dans .env ont été enregistrés de nouveau.');
      }
    }
  }

  setRuntimeSettings({
    config: parsed.data,
    values: managed({ ...asStrings(row.environment), ...secrets }),
    source: 'database',
    secretsStatus,
  });
}

/** What bde.config.yml and .env say, when they are complete; otherwise why they cannot be used. */
function readFiles(): { config: BdeConfig; values: SettingValues } | { problem: string } | null {
  let config: BdeConfig;
  try {
    config = loadConfigFile().config;
  } catch (error) {
    if (error instanceof ConfigError) {
      return { problem: error.message.split('\n')[0] ?? 'bde.config.yml' };
    }
    throw error;
  }

  const values = settingValuesFrom(process.env);
  if (config.auth.owners.some((owner) => owner.trim().toLowerCase() === PLACEHOLDER_OWNER)) {
    return null; // the template: nothing was decided
  }
  const { errors } = validateEnvironment({ ...process.env, ...values }, config);
  if (errors.length > 0) {
    return {
      problem: `${errors.length} valeur(s) de .env à corriger (voir « docker compose logs app »)`,
    };
  }
  return { config, values };
}

async function importFromFiles(db: SettingsDb, logger: Logger): Promise<InitializeResult> {
  const files = readFiles();
  // The unfilled template: nothing was decided, the installer in the browser takes over.
  if (!files) return { source: 'setup' };
  // Not complete: the platform runs from the files, as before, and the start-up checks report what is wrong.
  if ('problem' in files) return { source: 'files' };
  const { config, values } = files;

  const { environment, secrets } = splitSettings(values);
  try {
    await db.platformSettings.create({
      data: {
        id: PLATFORM_ID,
        config: JSON.parse(JSON.stringify(config)),
        environment,
        secrets: Object.keys(secrets).length > 0 ? seal(secrets, settingsKey()) : null,
        source: 'import',
        installedAt: new Date(),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another process imported at the same moment: take what it wrote.
    const row = await db.platformSettings.findUnique({ where: { id: PLATFORM_ID } });
    if (!row) throw error;
    await loadFromRow(db, row, logger);
    return { source: 'database' };
  }

  logger.log(
    '\n📦 Les réglages de bde.config.yml et de .env ont été copiés dans la base de données (les secrets y sont\n' +
      '   chiffrés). Désormais la base fait foi : modifier ces deux fichiers ne change plus rien.\n' +
      '   (Pour les remplacer par le contenu des fichiers : BDE_REIMPORT=1 dans .env, voir docs/configuration.md.)\n',
  );
  setRuntimeSettings({
    config,
    values: managed({ ...environment, ...secrets }),
    source: 'database',
  });
  return { source: 'import' };
}

/**
 * BDE_REIMPORT=1: replaces the settings of the database by the content of bde.config.yml and .env. For a
 * deployment that is driven by files (nobody opens the browser), and for whoever must change a setting by hand.
 * It does it at EVERY start while it is set, which overwrites what was changed from the app since.
 */
async function reimportFromFiles(db: SettingsDb, logger: Logger): Promise<boolean> {
  const files = readFiles();
  if (!files || 'problem' in files) {
    const why = files ? files.problem : 'bde.config.yml est le modèle non rempli';
    logger.warn(
      `\n⚠️  BDE_REIMPORT=1 est ignoré : bde.config.yml et .env ne sont pas complets (${why}).\n` +
        '    Les réglages de la base sont conservés.\n',
    );
    return false;
  }

  const { environment, secrets } = splitSettings(files.values);
  await db.platformSettings.update({
    where: { id: PLATFORM_ID },
    data: {
      config: JSON.parse(JSON.stringify(files.config)),
      environment,
      secrets: Object.keys(secrets).length > 0 ? seal(secrets, settingsKey()) : null,
      source: 'import',
    },
  });
  logger.warn(
    '\n🔁 BDE_REIMPORT=1 : les réglages de la base ont été remplacés par bde.config.yml et .env.\n' +
      '   Retirez cette variable de .env une fois fini : sinon, à chaque démarrage, elle écrase ce qui a été\n' +
      "   modifié depuis l'application.\n",
  );
  return true;
}

/**
 * BDE_REIMPORT=settings: puts the values of .env (the 42 application, the address, the mail server, the webhooks)
 * into the settings of the database, and nothing else: the owners, the campuses and the rest are left as they are.
 * It is the way back when nobody can sign in to the settings page (the secret of the 42 application expired, so
 * nobody can sign in at all) or when the `secrets` volume was lost.
 */
async function reimportEnvironment(db: SettingsDb, logger: Logger): Promise<void> {
  const fromEnvironment = settingValuesFrom(process.env);
  const row = await db.platformSettings.findUnique({ where: { id: PLATFORM_ID } });
  if (!row || Object.keys(fromEnvironment).length === 0) {
    logger.warn(
      "\n⚠️  BDE_REIMPORT=settings est ignoré : aucune des valeurs de .env (FORTYTWO_CLIENT_SECRET...) n'est renseignée.\n",
    );
    return;
  }

  let secrets: Record<string, string> = {};
  if (row.secrets) {
    try {
      secrets = unseal(row.secrets, settingsKey());
    } catch (error) {
      if (!(error instanceof SettingsDecryptError)) throw error;
    }
  }
  const merged = { ...asStrings(row.environment), ...secrets, ...fromEnvironment };
  const { environment, secrets: sealedValues } = splitSettings(managed(merged));
  await db.platformSettings.update({
    where: { id: PLATFORM_ID },
    data: {
      environment,
      secrets: Object.keys(sealedValues).length > 0 ? seal(sealedValues, settingsKey()) : null,
    },
  });
  logger.warn(
    `\n🔁 BDE_REIMPORT=settings : ${Object.keys(fromEnvironment).join(', ')} ont été repris de .env dans les réglages.\n` +
      '   Retirez cette variable de .env une fois fini.\n',
  );
}

/**
 * Loads the settings of the platform into memory (see runtime.ts). Called once when the server starts, after
 * the migrations. Throws PlatformSettingsError when the stored settings cannot be used.
 */
export async function initializePlatform(
  db: SettingsDb = prisma,
  logger: Logger = console,
): Promise<InitializeResult> {
  let row = await db.platformSettings.findUnique({ where: { id: PLATFORM_ID } });
  if (row) {
    const replaced =
      process.env.BDE_REIMPORT === 'settings'
        ? (await reimportEnvironment(db, logger), true)
        : process.env.BDE_REIMPORT === '1' && (await reimportFromFiles(db, logger));
    if (replaced) {
      row = await db.platformSettings.findUnique({ where: { id: PLATFORM_ID } });
      if (!row) throw new PlatformSettingsError('Les réglages ont disparu de la base de données.');
    }
    await loadFromRow(db, row, logger);
    return { source: 'database' };
  }
  return importFromFiles(db, logger);
}

/**
 * Installs the platform from what the installer collected: writes the settings row (the secrets sealed) and
 * loads it, so the platform works at once. `already-installed` when a row exists: the installer is over.
 */
export async function installPlatform(
  input: { config: BdeConfig; values: SettingValues },
  db: SettingsDb = prisma,
): Promise<'installed' | 'already-installed'> {
  const { environment, secrets } = splitSettings(input.values);
  try {
    await db.platformSettings.create({
      data: {
        id: PLATFORM_ID,
        config: JSON.parse(JSON.stringify(input.config)),
        environment,
        secrets: Object.keys(secrets).length > 0 ? seal(secrets, settingsKey()) : null,
        source: 'installer',
        installedAt: new Date(),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return 'already-installed';
    throw error;
  }
  setRuntimeSettings({
    config: input.config,
    values: managed({ ...environment, ...secrets }),
    source: 'database',
  });
  return 'installed';
}

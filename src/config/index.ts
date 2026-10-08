import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { getRuntimeConfig } from '@/lib/settings/runtime';
import { bdeConfigSchema, type BdeConfig } from './schema';

export class ConfigError extends Error {}

const DEFAULT_CONFIG_FILENAME = 'bde.config.yml';
/** Optional git-ignored override: when present it is used instead of
 * bde.config.yml, so personal values never end up in a commit. */
const LOCAL_CONFIG_FILENAME = 'bde.config.local.yml';

function resolveConfigFilename(): string {
  return existsSync(join(process.cwd(), LOCAL_CONFIG_FILENAME))
    ? LOCAL_CONFIG_FILENAME
    : DEFAULT_CONFIG_FILENAME;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return 'ce champ est requis';
  }
  return issue.message;
}

function formatZodError(error: z.ZodError, filename: string): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(racine)';
    return `  • ${path} : ${describeIssue(issue)}`;
  });

  return [
    `Configuration invalide dans ${filename} :`,
    '',
    ...lines,
    '',
    `Corrigez ces champs dans ${filename}, puis relancez l'application.`,
    "Besoin d'un exemple ? Voir bde.config.example.yml ou docs/configuration.md.",
  ].join('\n');
}

/** Why the file cannot be read, in words a non-developer can act on. "Not found" used to cover every
 * failure and sent people looking for a file that was there: a directory, a permission, a mount. */
export function describeReadFailure(filename: string, path: string, cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  const checked = `  Chemin vérifié : ${path}`;
  const recreate = `une copie de bde.config.example.yml nommée ${filename}`;

  let isDirectory = false;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch {
    /* not even visible: the error code below tells why */
  }

  if (isDirectory || code === 'EISDIR') {
    return [
      `Un DOSSIER nommé ${filename} se trouve à la place du fichier.`,
      checked,
      '',
      "Cela arrive quand Docker doit « monter » un fichier qu'il ne voit pas (dossier personnel sur un",
      'partage réseau, Docker sans droits administrateur) : il crée alors un dossier vide du même nom.',
      '',
      `À faire, depuis le dossier du projet : supprimez ce dossier (rmdir ${filename}), recréez le fichier avec`,
      `${recreate}, puis relancez : docker compose up --build -d`,
    ].join('\n');
  }

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return [
      `Le fichier ${filename} est introuvable.`,
      checked,
      '',
      `À faire, depuis le dossier du projet : créez-le avec ${recreate},`,
      'puis relancez : docker compose up --build -d',
      "(avec Docker, le fichier est copié dans l'image pendant le « --build » : il doit exister à ce moment-là).",
    ].join('\n');
  }

  return [
    `Le fichier ${filename} existe mais ne peut pas être lu${code ? ` (code ${code})` : ''}.`,
    checked,
    '',
    `À faire : vérifiez ses droits (ls -l ${filename}) : il doit être lisible par tout le monde`,
    `(chmod 644 ${filename}), comme le dossier qui le contient. Si le projet est sur un partage réseau,`,
    'copiez-le sur le disque local de la machine, puis relancez : docker compose up --build -d',
  ].join('\n');
}

function readConfigFile(filename: string): unknown {
  const path = join(process.cwd(), filename);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (cause) {
    throw new ConfigError(describeReadFailure(filename, path, cause));
  }

  // js-yaml refuses a file made only of comments and blank lines: say "empty", not "syntax error".
  const isEmpty = raw.replace(/#.*/g, '').trim() === '';
  let parsed: unknown;
  try {
    parsed = isEmpty ? undefined : parseYaml(raw);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigError(
      [
        `Le fichier ${filename} contient une erreur de syntaxe YAML :`,
        '',
        `  ${message}`,
        '',
        "Corrigez la syntaxe (indentation, deux-points, guillemets) puis relancez l'application.",
      ].join('\n'),
    );
  }

  if (parsed === undefined || parsed === null) {
    throw new ConfigError(
      [
        `Le fichier ${filename} est vide.`,
        `  Chemin vérifié : ${path}`,
        '',
        'Remplissez-le (modèle : bde.config.example.yml) ou recopiez ce modèle,',
        'puis relancez : docker compose up --build -d',
      ].join('\n'),
    );
  }
  return parsed;
}

function logLoadedConfig(config: BdeConfig, filename: string): void {
  const campusesLabel =
    config.auth.allowedCampuses.length > 0
      ? config.auth.allowedCampuses.join(', ')
      : 'tous (aucun filtre)';
  const modulesLabel =
    config.modules.enabled.length > 0 ? config.modules.enabled.join(', ') : '(aucun)';

  console.log(
    [
      `📋 ${filename} chargée :`,
      `  • propriétaires (owners) : ${config.auth.owners.join(', ')}`,
      `  • campus autorisés : ${campusesLabel}`,
      `  • modules activés : ${modulesLabel}`,
    ].join('\n'),
  );
}

let cachedConfig: BdeConfig | undefined;

/** Reads and validates bde.config.local.yml if present, else bde.config.yml. Throws ConfigError with a
 * human-readable message on any failure. Not cached: used by getConfig(), and once by the import of an
 * installation that predates the database settings (src/lib/settings/store.ts). */
export function loadConfigFile(): { config: BdeConfig; filename: string } {
  const filename = resolveConfigFilename();
  const raw = readConfigFile(filename);
  const result = bdeConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new ConfigError(formatZodError(result.error, filename));
  }
  return { config: result.data, filename };
}

/** The configuration of the BDE. Once the platform is loaded from its database settings it is theirs
 * (kept up to date as they change); before that, bde.config.local.yml or bde.config.yml, loaded, validated
 * and cached. Throws ConfigError with a human-readable message when the file cannot be used: callers
 * should let this crash the process at boot rather than catch it silently. */
export function getConfig(): BdeConfig {
  const runtime = getRuntimeConfig();
  if (runtime) {
    return runtime;
  }
  if (cachedConfig) {
    return cachedConfig;
  }

  const { config, filename } = loadConfigFile();
  cachedConfig = config;
  logLoadedConfig(cachedConfig, filename);
  return cachedConfig;
}

export type {
  BdeConfig,
  EventCategory,
  NotificationChannel,
  NotificationEvent,
  SupportedLocale,
} from './schema';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
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

function readConfigFile(filename: string): unknown {
  const path = join(process.cwd(), filename);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new ConfigError(
      [
        `Le fichier ${filename} est introuvable à la racine du projet.`,
        '',
        `Copiez bde.config.example.yml vers ${filename} et remplissez-le,`,
        "puis relancez l'application.",
      ].join('\n'),
    );
  }

  try {
    return parseYaml(raw);
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

/** Loads, validates (Zod) and caches bde.config.local.yml if present, else bde.config.yml. Throws ConfigError with a
 * human-readable message on any failure — callers should let this crash the
 * process at boot rather than catch it silently. */
export function getConfig(): BdeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const filename = resolveConfigFilename();
  const raw = readConfigFile(filename);
  const result = bdeConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new ConfigError(formatZodError(result.error, filename));
  }

  cachedConfig = result.data;
  logLoadedConfig(cachedConfig, filename);
  return cachedConfig;
}

export type { BdeConfig, NotificationChannel, NotificationEvent, SupportedLocale } from './schema';

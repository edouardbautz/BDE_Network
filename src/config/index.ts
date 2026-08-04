import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { bdeConfigSchema, type BdeConfig } from './schema';

export class ConfigError extends Error {}

const CONFIG_FILENAME = 'bde.config.yml';

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(racine)';
    return `  • ${path} : ${issue.message}`;
  });

  return [
    `Configuration invalide dans ${CONFIG_FILENAME} :`,
    '',
    ...lines,
    '',
    `Corrigez ces champs dans ${CONFIG_FILENAME}, puis relancez l'application.`,
    "Besoin d'un exemple ? Voir bde.config.example.yml ou docs/configuration.md.",
  ].join('\n');
}

function readConfigFile(): unknown {
  const path = join(process.cwd(), CONFIG_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new ConfigError(
      [
        `Le fichier ${CONFIG_FILENAME} est introuvable à la racine du projet.`,
        '',
        `Copiez bde.config.example.yml vers ${CONFIG_FILENAME} et remplissez-le,`,
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
        `Le fichier ${CONFIG_FILENAME} contient une erreur de syntaxe YAML :`,
        '',
        `  ${message}`,
        '',
        "Corrigez la syntaxe (indentation, deux-points, guillemets) puis relancez l'application.",
      ].join('\n'),
    );
  }
}

let cachedConfig: BdeConfig | undefined;

/** Loads, validates (Zod) and caches bde.config.yml. Throws ConfigError with a
 * human-readable message on any failure — callers should let this crash the
 * process at boot rather than catch it silently. */
export function getConfig(): BdeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = readConfigFile();
  const result = bdeConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new ConfigError(formatZodError(result.error));
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export type { BdeConfig, NotificationChannel, NotificationEvent, SupportedLocale } from './schema';

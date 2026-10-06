import { EVENTS_MODULE_KEY, KNOWN_MODULE_KEYS, type BdeConfig } from './schema';

/**
 * Checks of the secrets and machine settings in `.env`, the counterpart of the
 * validation of `bde.config.yml` (see schema.ts). Every message is written for
 * the person who installs the platform, not for a developer: it says what is
 * wrong, what the variable is for and how to fix it.
 */

type Env = Record<string, string | undefined>;

export interface EnvironmentReport {
  /** The application cannot work: it refuses to start. */
  errors: string[];
  /** It starts, but something is probably not what the operator wants. */
  warnings: string[];
}

/** The login written in the example config. Nobody has it, so keeping it means no owner. */
export const PLACEHOLDER_OWNER = 'votre-login-42';

const MIN_SECRET_LENGTH = 32;
const OAUTH_APPS_URL = 'https://profile.intra.42.fr/oauth/applications';

/** Notification events of the events module: a channel left unconfigured is an error. */
const EVENTS_NOTIFICATIONS = ['eventConfirmed', 'eventReminder'] as const;

/**
 * Notifications about members. Their channels were already in every config before they sent
 * anything (the example even had `memberPending: email`), so a channel that is not set up is
 * a warning here, not a reason to refuse to start: the platform works, the alerts do not go out.
 */
const MEMBER_NOTIFICATIONS = ['memberPending', 'memberApproved', 'memberRemoved'] as const;

const isBlank = (value: string | undefined): boolean => !value || value.trim() === '';

function isLocalAddress(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Notification channels the configuration actually relies on. */
function channelsInUse(config: BdeConfig): Set<string> {
  const channels = new Set<string>();
  if (config.modules.enabled.includes(EVENTS_MODULE_KEY)) {
    for (const event of EVENTS_NOTIFICATIONS) {
      channels.add(config.notifications[event]);
    }
  }
  return channels;
}

export function validateEnvironment(env: Env, config: BdeConfig): EnvironmentReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const appUrl = env.APP_URL?.trim() || undefined;
  const parsedAppUrl = appUrl ? parseUrl(appUrl) : null;
  const publicUrl = (parsedAppUrl && appUrl ? appUrl : 'http://localhost:3000').replace(/\/+$/, '');

  // --- Authentication -------------------------------------------------------
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    errors.push(
      "AUTH_SECRET est vide. C'est la clé secrète qui protège les connexions des membres.\n" +
        '    → Générez-en une avec cette commande (Docker, sous Windows, Linux et macOS) :\n' +
        '        docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"\n' +
        '      puis collez le résultat après « AUTH_SECRET= » dans le fichier .env.',
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `AUTH_SECRET est trop court (${secret.length} caractères, il en faut au moins ${MIN_SECRET_LENGTH}) : ` +
        'une clé courte se devine facilement.\n' +
        '    → Générez-en une avec : docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"\n' +
        '      et remplacez la valeur dans .env.',
    );
  }

  for (const [name, label] of [
    ['FORTYTWO_CLIENT_ID', "l'identifiant (UID)"],
    ['FORTYTWO_CLIENT_SECRET', 'la clé secrète (SECRET)'],
  ] as const) {
    if (isBlank(env[name])) {
      errors.push(
        `${name} est vide. Il permet à la plateforme de demander à 42 qui se connecte.\n` +
          `    → Créez une application sur ${OAUTH_APPS_URL}, recopiez-en ${label} dans .env,\n` +
          `      et indiquez comme URL de redirection : ${publicUrl}/api/auth/callback/42-school`,
      );
    }
  }

  // --- Database -------------------------------------------------------------
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    errors.push(
      'DATABASE_URL est vide ou invalide : la plateforme ne sait pas où est sa base de données.\n' +
        '    → Elle doit ressembler à postgresql://utilisateur:motdepasse@serveur:5432/base.\n' +
        '      Avec docker compose elle est fournie automatiquement par docker-compose.yml :\n' +
        "      si vous voyez ce message, vérifiez que ce fichier n'a pas été modifié.",
    );
  }

  // --- Public address -------------------------------------------------------
  if (appUrl && !parsedAppUrl) {
    errors.push(
      `APP_URL (« ${appUrl} ») n'est pas une adresse valide.\n` +
        "    → Écrivez l'adresse complète du site, par exemple https://bde.exemple.fr, ou laissez la ligne vide.",
    );
  } else if (parsedAppUrl && !/^https?:$/.test(parsedAppUrl.protocol)) {
    errors.push(
      `APP_URL (« ${appUrl} ») doit commencer par https:// (ou http://).\n` +
        '    → Exemple : https://bde.exemple.fr',
    );
  } else if (parsedAppUrl?.protocol === 'http:' && !isLocalAddress(parsedAppUrl)) {
    warnings.push(
      'APP_URL commence par http:// : les connexions ne sont pas chiffrées, et la session des membres\n' +
        "    peut être interceptée par n'importe qui sur le réseau. Mettez la plateforme derrière un proxy\n" +
        '    HTTPS (voir docs/deployment.md, section « Reverse proxy HTTPS »).',
    );
  }

  // --- Notification channels actually used ----------------------------------
  const channels = channelsInUse(config);

  if (channels.has('email')) {
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'] as const) {
      if (isBlank(env[name])) {
        errors.push(
          `${name} est vide alors que des notifications sont réglées sur « email » dans bde.config.yml.\n` +
            "    → Renseignez le serveur d'envoi d'e-mails dans .env (SMTP_HOST, SMTP_PORT, SMTP_FROM),\n" +
            '      ou remplacez « email » par « none » dans la section notifications de bde.config.yml.',
        );
      }
    }
    const port = env.SMTP_PORT?.trim();
    if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
      errors.push(
        `SMTP_PORT (« ${port} ») doit être un numéro de port, par exemple 587.\n` +
          '    → Corrigez la valeur dans .env.',
      );
    }
  }

  for (const [channel, variable, service] of [
    ['discord', 'DISCORD_WEBHOOK_URL', 'Discord'],
    ['slack', 'SLACK_WEBHOOK_URL', 'Slack'],
  ] as const) {
    if (!channels.has(channel)) continue;
    const value = env[variable]?.trim();
    if (!value) {
      errors.push(
        `${variable} est vide alors que des notifications sont réglées sur « ${channel} » dans bde.config.yml.\n` +
          `    → Collez l'adresse du webhook ${service} dans .env, ou remplacez « ${channel} » par « none »\n` +
          '      dans la section notifications de bde.config.yml.',
      );
    } else if (!/^https:\/\//i.test(value)) {
      errors.push(
        `${variable} doit être une adresse commençant par https:// (celle que ${service} vous a donnée).\n` +
          '    → Recopiez-la en entier dans .env.',
      );
    }
  }

  // --- bde.config.yml: the placeholder owner --------------------------------
  if (config.auth.owners.some((owner) => owner.trim().toLowerCase() === PLACEHOLDER_OWNER)) {
    warnings.push(
      `bde.config.yml contient encore « ${PLACEHOLDER_OWNER} » dans auth.owners.\n` +
        "    Tant que vous n'y avez pas mis votre vrai login 42, personne n'est propriétaire :\n" +
        "    aucune demande d'accès ne pourra être validée.\n" +
        '    → Remplacez-le par votre login 42, puis relancez : docker compose restart app',
    );
  }

  warnMemberNotifications(env, config, warnings);

  // --- bde.config.yml: modules.enabled ---------------------------------------
  const unknownModules = config.modules.enabled.filter((key) => !KNOWN_MODULE_KEYS.includes(key));
  if (unknownModules.length > 0) {
    warnings.push(
      `modules.enabled de bde.config.yml contient ${unknownModules.map((key) => `« ${key} »`).join(', ')}, ` +
        `qui n'est pas un module de cette version (modules disponibles : ${KNOWN_MODULE_KEYS.join(', ')}).\n` +
        '    Une faute de frappe ? Ce module restera sans effet.\n' +
        "    → Corrigez le nom, ou, si c'est un module ajouté à votre fork, déclarez-le dans KNOWN_MODULE_KEYS (src/config/schema.ts).",
    );
  }

  return { errors, warnings };
}

/** What each channel needs in `.env`, for a warning about a member notification. */
const CHANNEL_VARIABLES: Record<string, readonly string[]> = {
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'],
  discord: ['DISCORD_WEBHOOK_URL'],
  slack: ['SLACK_WEBHOOK_URL'],
};

function warnMemberNotifications(env: Env, config: BdeConfig, warnings: string[]): void {
  for (const event of MEMBER_NOTIFICATIONS) {
    const channel = config.notifications[event];

    if (event === 'memberRemoved' && channel === 'email') {
      warnings.push(
        "La notification memberRemoved est réglée sur « email », mais elle n'envoie jamais d'e-mail\n" +
          '    (la personne retirée ne reçoit rien). Elle ne fonctionne que sur « discord » ou « slack ».\n' +
          '    → Changez-la dans la section notifications de bde.config.yml, ou mettez « none ».',
      );
      continue;
    }

    const missing = (CHANNEL_VARIABLES[channel] ?? []).filter((name) => isBlank(env[name]));
    if (missing.length > 0) {
      warnings.push(
        `La notification ${event} est réglée sur « ${channel} », mais ${missing.join(', ')} ${
          missing.length > 1 ? 'ne sont pas renseignés' : "n'est pas renseigné"
        } dans .env : l'alerte ne partira pas.\n` +
          `    → Renseignez-le dans .env, ou mettez « none » pour ${event} dans bde.config.yml.`,
      );
    }
  }
}

/** The message printed when the application refuses to start. */
export function formatEnvironmentErrors(errors: string[]): string {
  const count =
    errors.length === 1
      ? 'une valeur du fichier .env doit être corrigée'
      : `${errors.length} valeurs du fichier .env doivent être corrigées`;

  return [
    `Configuration incomplète : ${count}.`,
    '',
    ...errors.map((error) => `  • ${error}`),
    '',
    "Corrigez le fichier .env, puis relancez l'application (docker compose up -d).",
    "Besoin d'aide ? Voir .env.example et docs/configuration.md.",
  ].join('\n');
}

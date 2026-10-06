import { randomBytes, randomInt } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import {
  bdeConfigSchema,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from '../src/config/schema';
import type { Answers } from './answers';

export const ENV_FILE = '.env';
export const CONFIG_FILE = 'bde.config.yml';
export const BACKUP_DIR = '.setup-backups';

// ---------------------------------------------------------------------------------------------
// Secrets

/** 32 random bytes in base64: 44 characters, well over the 32 the platform asks for. */
export function generateAuthSecret(): string {
  return randomBytes(32).toString('base64');
}

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 24 letters and digits: safe in a connection URL and in the .env file without any escaping. */
export function generatePassword(length = 24): string {
  return Array.from({ length }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join('');
}

// ---------------------------------------------------------------------------------------------
// What is already there

export interface ExistingState {
  /** Values of the current .env, unquoted. */
  env: Map<string, string>;
  /** The current .env text, or null when there is none. */
  envText: string | null;
  /** The current bde.config.yml as parsed (not validated), or null. */
  config: Record<string, unknown> | null;
  /** bde.config.local.yml exists: it replaces bde.config.yml when the platform starts. */
  hasLocalConfig: boolean;
}

/** `KEY=value`, `KEY='value'`, `KEY="value"`, `export KEY=value`; comments and blank lines ignored. */
export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === "'" || quote === '"') && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    values.set(match[1], value);
  }
  return values;
}

const readIfExists = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;

export function readExisting(projectDir: string): ExistingState {
  const envText = readIfExists(join(projectDir, ENV_FILE));
  const configText = readIfExists(join(projectDir, CONFIG_FILE));

  let config: Record<string, unknown> | null = null;
  if (configText !== null) {
    try {
      const parsed = load(configText);
      config = isRecord(parsed) ? parsed : null;
    } catch {
      config = null; // not valid YAML: the assistant starts from its own defaults
    }
  }

  return {
    env: envText === null ? new Map() : parseEnv(envText),
    envText,
    config,
    hasLocalConfig: existsSync(join(projectDir, 'bde.config.local.yml')),
  };
}

// ---------------------------------------------------------------------------------------------
// .env

/** A value as the .env file holds it: bare when it is plain, in single quotes otherwise (nothing
 * is expanded or interpreted inside them). The validators keep apostrophes out of every value. */
export function formatEnvValue(value: string): string {
  if (/[\r\n\0']/.test(value)) throw new Error('a value that cannot be written to .env');
  return /^[A-Za-z0-9_@%+=:,./-]*$/.test(value) ? value : `'${value}'`;
}

/**
 * The .env text with `changes` applied: the line of each key is replaced in place (a commented-out
 * `# KEY=` line is used when there is no active one), the keys that are not there yet are added at
 * the end, and every other line, comment and variable is left exactly as it was.
 */
export function renderEnv(base: string, changes: Record<string, string>): string {
  const lines = base.split(/\r?\n/);
  const pending = new Map(Object.entries(changes));

  const activeAt = new Map<string, number>();
  const commentedAt = new Map<string, number>();
  lines.forEach((line, index) => {
    const active = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (active && !activeAt.has(active)) activeAt.set(active, index);
    const commented = /^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (commented && !commentedAt.has(commented)) commentedAt.set(commented, index);
  });

  for (const [key, value] of pending) {
    const index = activeAt.get(key) ?? commentedAt.get(key);
    if (index !== undefined) {
      lines[index] = `${key}=${formatEnvValue(value)}`;
      pending.delete(key);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (pending.size > 0) {
    lines.push('', '# --- Added by the setup assistant ---');
    for (const [key, value] of pending) lines.push(`${key}=${formatEnvValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The .env values the answers decide. Optional blocks (SMTP, webhooks) appear only when chosen. */
export function envChanges(
  answers: Answers,
  existing: ReadonlyMap<string, string>,
): Record<string, string> {
  const user = existing.get('POSTGRES_USER') || 'bde';
  const database = existing.get('POSTGRES_DB') || 'bde_network';

  const changes: Record<string, string> = {
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: answers.postgresPassword,
    POSTGRES_DB: database,
    DATABASE_URL: `postgresql://${user}:${answers.postgresPassword}@localhost:5432/${database}?schema=public`,
    AUTH_SECRET: answers.authSecret,
    FORTYTWO_CLIENT_ID: answers.clientId,
    FORTYTWO_CLIENT_SECRET: answers.clientSecret,
    APP_URL: answers.address.url,
  };

  // The port the platform is published on, from this computer: only a local try-out chooses it.
  if (answers.address.isLocal) changes.APP_PORT = String(answers.address.port);

  const { notifications } = answers;
  if (notifications.mode === 'discord' && notifications.discordWebhook) {
    changes.DISCORD_WEBHOOK_URL = notifications.discordWebhook;
  }
  if (notifications.mode === 'slack' && notifications.slackWebhook) {
    changes.SLACK_WEBHOOK_URL = notifications.slackWebhook;
  }
  if (notifications.mode === 'email' && notifications.smtp) {
    const { host, port, user: smtpUser, password, from } = notifications.smtp;
    changes.SMTP_HOST = host;
    changes.SMTP_PORT = String(port);
    changes.SMTP_USER = smtpUser;
    changes.SMTP_PASSWORD = password;
    changes.SMTP_FROM = from;
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------
// bde.config.yml

const q = (text: string): string => `'${text.replace(/'/g, "''")}'`;

const DEFAULT_CATEGORIES = [
  { key: 'soiree', label: 'Soirée', color: '#db2777' },
  { key: 'sport', label: 'Sport', color: '#16a34a' },
  { key: 'wei', label: 'WEI', color: '#ea580c' },
  { key: 'partenariat', label: 'Partenariat', color: '#2563eb' },
];

interface Category {
  key: string;
  label: string;
  color: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function existingCategories(config: Record<string, unknown> | null): Category[] | null {
  const events = config?.events;
  const categories = isRecord(events) ? events.categories : undefined;
  if (!Array.isArray(categories)) return null;
  const valid = categories.filter(
    (c): c is Category =>
      isRecord(c) &&
      typeof c.key === 'string' &&
      typeof c.label === 'string' &&
      typeof c.color === 'string',
  );
  return valid.length > 0 ? valid : null;
}

/** The notification channel of each event: the answer, or what the current configuration says. */
function channelsFor(
  answers: Answers,
  config: Record<string, unknown> | null,
): Record<NotificationEvent, NotificationChannel> {
  const current = isRecord(config?.notifications) ? config.notifications : {};
  const result = {} as Record<NotificationEvent, NotificationChannel>;
  for (const event of NOTIFICATION_EVENTS) {
    const kept = current[event];
    const keptChannel: NotificationChannel =
      kept === 'email' || kept === 'discord' || kept === 'slack' ? kept : 'none';
    result[event] =
      answers.notifications.mode === 'keep' ? keptChannel : answers.notifications.mode;
  }
  return result;
}

const COMMENTS = {
  fr: {
    header:
      "# Configuration du BDE, écrite par l'assistant d'installation (relancez-le pour la modifier).\n# Chaque champ est expliqué dans bde.config.example.yml et docs/configuration.md.",
    owners: '# Logins 42 des propriétaires : ils ont tous les droits dès leur première connexion.',
    campuses: '# Campus 42 autorisés à se connecter (liste vide = tous les campus).',
    modules: '# Modules activés.',
    notifications: '# Canal de chaque notification : "email", "discord", "slack" ou "none".',
  },
  en: {
    header:
      '# BDE configuration, written by the setup assistant (run it again to change it).\n# Every field is explained in bde.config.example.yml and docs/configuration.md.',
    owners: '# 42 logins of the owners: they hold every right from their first sign-in.',
    campuses: '# 42 campuses allowed to sign in (empty list = every campus).',
    modules: '# Enabled modules.',
    notifications: '# Channel of each notification: "email", "discord", "slack" or "none".',
  },
} as const;

/**
 * The text of bde.config.yml for these answers. What the assistant does not ask (the logo, the contact
 * address, other modules, the event categories) is carried over from the current file. The result is
 * validated with the very schema the platform uses at start-up, so what is written always starts.
 */
export function renderConfig(answers: Answers, current: Record<string, unknown> | null): string {
  const text = COMMENTS[answers.lang];
  const bdeCurrent = isRecord(current?.bde) ? current.bde : {};
  const logoPath = typeof bdeCurrent.logoPath === 'string' ? bdeCurrent.logoPath : '/logo.svg';
  const contactEmail = typeof bdeCurrent.contactEmail === 'string' ? bdeCurrent.contactEmail : null;

  const modulesCurrent =
    isRecord(current?.modules) && Array.isArray(current.modules.enabled)
      ? current.modules.enabled.filter((key): key is string => typeof key === 'string')
      : [];
  const modules = [
    ...new Set([
      ...modulesCurrent.filter((key) => key !== 'events'),
      ...(answers.events ? ['events'] : []),
    ]),
  ];

  const channels = channelsFor(answers, current);
  const categories = existingCategories(current) ?? DEFAULT_CATEGORIES;
  const currentEvents = isRecord(current?.events) ? current.events : {};
  const reminderHour =
    typeof currentEvents.reminderHour === 'number' ? currentEvents.reminderHour : 18;

  const lines = [
    text.header,
    '',
    'bde:',
    `  name: ${q(answers.name)}`,
    `  campus: ${q(answers.mainCampus)}`,
    `  timezone: ${q(answers.timezone)}`,
    `  defaultLocale: ${q(answers.messageLocale)}`,
    `  accentColor: ${q(answers.accentColor)}`,
    `  logoPath: ${q(logoPath)}`,
    ...(contactEmail ? [`  contactEmail: ${q(contactEmail)}`] : []),
    '',
    'auth:',
    `  ${text.owners}`,
    '  owners:',
    ...answers.owners.map((login) => `    - ${q(login)}`),
    `  ${text.campuses}`,
    ...(answers.campuses.length > 0
      ? ['  allowedCampuses:', ...answers.campuses.map((name) => `    - ${q(name)}`)]
      : ['  allowedCampuses: []']),
    '',
    'modules:',
    `  ${text.modules}`,
    ...(modules.length > 0
      ? ['  enabled:', ...modules.map((key) => `    - ${q(key)}`)]
      : ['  enabled: []']),
  ];

  if (answers.events) {
    lines.push(
      '',
      'events:',
      '  categories:',
      ...categories.map(
        (category) =>
          `    - { key: ${q(category.key)}, label: ${q(category.label)}, color: ${q(category.color)} }`,
      ),
      `  reminderHour: ${reminderHour}`,
    );
  }

  lines.push(
    '',
    'notifications:',
    `  ${text.notifications}`,
    ...NOTIFICATION_EVENTS.map((event) => `  ${event}: ${q(channels[event])}`),
  );

  const rendered = `${lines.join('\n')}\n`;

  // What is written must be what the platform accepts: check it with the platform's own schema.
  const checked = bdeConfigSchema.safeParse(load(rendered));
  if (!checked.success) {
    throw new Error(
      `the generated configuration is invalid: ${checked.error.issues[0]?.message ?? '?'}`,
    );
  }
  return rendered;
}

// ---------------------------------------------------------------------------------------------
// Writing

const pad = (n: number) => String(n).padStart(2, '0');

/** `20261006-142530`, in UTC: a folder name that sorts by date. */
export function backupStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

export interface WriteResult {
  /** The files that were created or changed. */
  written: string[];
  /** The folder holding the previous versions, when there were any to keep. */
  backupDir: string | null;
}

/**
 * Writes .env and bde.config.yml. Each previous file that is about to change is first copied to
 * `.setup-backups/<date>/`; both new files are written to temporary names and only then renamed over
 * the real ones, so an interruption never leaves a half-written file. On Linux the files are given
 * to the owner of the project folder (the assistant runs as root in its container).
 */
export function writeFiles(
  projectDir: string,
  files: { env: string; config: string },
  now: Date = new Date(),
): WriteResult {
  const targets = [
    { name: ENV_FILE, content: files.env, mode: 0o600 },
    { name: CONFIG_FILE, content: files.config, mode: 0o644 },
  ].map((target) => {
    const path = join(projectDir, target.name);
    const previous = readIfExists(path);
    return { ...target, path, previous, changed: previous !== target.content };
  });

  const owner = statSync(projectDir);
  const giveToOwner = (path: string) => {
    try {
      chownSync(path, owner.uid, owner.gid);
    } catch {
      /* Windows and macOS mounts: the owner is already the person */
    }
  };

  const changing = targets.filter((target) => target.changed);
  const backupDir = join(projectDir, BACKUP_DIR, backupStamp(now));
  const toBackUp = changing.filter((target) => target.previous !== null);
  if (toBackUp.length > 0) {
    mkdirSync(backupDir, { recursive: true });
    giveToOwner(join(projectDir, BACKUP_DIR));
    giveToOwner(backupDir);
    for (const target of toBackUp) {
      const copy = join(backupDir, target.name);
      copyFileSync(target.path, copy);
      chmodSync(copy, 0o600);
      giveToOwner(copy);
    }
  }

  const temporary = changing.map((target) => ({ ...target, temp: `${target.path}.setup-tmp` }));
  try {
    for (const target of temporary) {
      writeFileSync(target.temp, target.content, { mode: target.mode });
      chmodSync(target.temp, target.mode);
      giveToOwner(target.temp);
    }
    for (const target of temporary) renameSync(target.temp, target.path);
  } catch (error) {
    for (const target of temporary) if (existsSync(target.temp)) unlinkSync(target.temp);
    throw error;
  }

  return {
    written: changing.map((target) => target.name),
    backupDir: toBackUp.length > 0 ? join(BACKUP_DIR, backupStamp(now)) : null,
  };
}

/** A starting point for a first .env: the project's own template, or nothing. */
export function envTemplate(projectDir: string): string {
  return readIfExists(join(projectDir, '.env.example')) ?? '';
}

import { validateEnvironment } from '@/config/env';
import { bdeConfigSchema, type BdeConfig } from '@/config/schema';
import type { SettingValues } from '@/lib/settings/runtime';
import type { SetupDraft } from './draft';
import type { Channel } from './notifications';

/** The event categories a BDE starts with (the ones of the example configuration); editable later. */
export const DEFAULT_CATEGORIES = [
  { key: 'soiree', label: 'Soirée', color: '#db2777' },
  { key: 'sport', label: 'Sport', color: '#16a34a' },
  { key: 'wei', label: 'WEI', color: '#ea580c' },
  { key: 'partenariat', label: 'Partenariat', color: '#2563eb' },
];

/** The channel of every notification, for one channel chosen for all. */
export function notificationChannels(channel: Channel) {
  return {
    memberPending: channel,
    memberApproved: channel,
    // Nobody is written to when a member is removed: the e-mail channel does nothing for it.
    memberRemoved: channel === 'email' ? ('none' as const) : channel,
    eventConfirmed: channel,
    eventReminder: channel,
  };
}

export type Installation =
  | { ok: true; config: BdeConfig; values: SettingValues }
  /** Something has not been answered (the person skipped a step by calling the server directly). */
  | { ok: false; reason: 'incomplete' }
  /** What was answered does not make a platform that can start: `issues` names the settings. */
  | { ok: false; reason: 'invalid'; issues: string[] };

/**
 * What is installed, from the draft: the configuration of the BDE and the settings that used to be in `.env`.
 * Checked with the very schema and the very rules the platform applies when it starts, so that what is
 * written is always something that starts.
 */
export function buildInstallation(
  draft: SetupDraft,
  env: Record<string, string | undefined> = process.env,
): Installation {
  const {
    name,
    accentColor,
    messageLocale,
    contactEmail,
    address,
    clientId,
    clientSecret,
    campuses,
    mainCampus,
    timezone,
    owners,
    events,
    notifications,
  } = draft;

  if (
    !name ||
    !accentColor ||
    !messageLocale ||
    !address ||
    !clientId ||
    !clientSecret ||
    !campuses ||
    !mainCampus ||
    !timezone ||
    !owners ||
    owners.length === 0 ||
    events === undefined ||
    !notifications ||
    !(draft.credentialsVerified || draft.credentialsSkipped)
  ) {
    return { ok: false, reason: 'incomplete' };
  }

  const channel = notifications.mode;
  const candidate = {
    bde: {
      name,
      campus: mainCampus,
      timezone,
      defaultLocale: messageLocale,
      accentColor,
      logoPath: '/logo.svg',
      ...(contactEmail && { contactEmail }),
    },
    auth: { owners, allowedCampuses: campuses },
    modules: { enabled: events ? ['events'] : [] },
    ...(events ? { events: { categories: DEFAULT_CATEGORIES, reminderHour: 18 } } : {}),
    notifications: notificationChannels(channel),
  };

  const parsed = bdeConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((issue) => issue.path.join('.') || 'config'),
    };
  }

  const values: SettingValues = {
    APP_URL: address.url,
    FORTYTWO_CLIENT_ID: clientId,
    FORTYTWO_CLIENT_SECRET: clientSecret,
  };
  if (channel === 'discord' && notifications.discordWebhook) {
    values.DISCORD_WEBHOOK_URL = notifications.discordWebhook;
  }
  if (channel === 'slack' && notifications.slackWebhook) {
    values.SLACK_WEBHOOK_URL = notifications.slackWebhook;
  }
  if (channel === 'email' && notifications.smtp) {
    const { host, port, user, password, from } = notifications.smtp;
    values.SMTP_HOST = host;
    values.SMTP_PORT = String(port);
    values.SMTP_FROM = from;
    if (user) values.SMTP_USER = user;
    if (password) values.SMTP_PASSWORD = password;
  }

  const { errors, variables } = validateEnvironment({ ...env, ...values }, parsed.data);
  if (errors.length > 0) return { ok: false, reason: 'invalid', issues: variables };

  return { ok: true, config: parsed.data, values };
}

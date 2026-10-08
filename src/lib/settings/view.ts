import { getConfig } from '@/config';
import { EVENTS_MODULE_KEY, type EventCategory } from '@/config/schema';
import { logoVersionOf } from '@/lib/branding/storage';
import { prisma } from '@/lib/prisma';
import type { DraftView } from '@/lib/setup/draft';
import { setting } from './runtime';
import { channelOf } from './update';

/**
 * The settings as the settings page shows them: the same shape as what the installer shows of its draft (the
 * pages share their forms), with no secret in it, only whether there is one. Read from the running settings.
 */
export function settingsView(): DraftView {
  const config = getConfig();
  return {
    step: 8,
    name: config.bde.name,
    accentColor: config.bde.accentColor,
    messageLocale: config.bde.defaultLocale,
    contactEmail: config.bde.contactEmail ?? '',
    addressUrl: setting('APP_URL') ?? '',
    clientId: setting('FORTYTWO_CLIENT_ID') ?? '',
    hasClientSecret: Boolean(setting('FORTYTWO_CLIENT_SECRET')),
    credentialsVerified: false,
    credentialsSkipped: false,
    campuses: config.auth.allowedCampuses,
    mainCampus: config.bde.campus,
    timezone: config.bde.timezone,
    owners: config.auth.owners,
    events: config.modules.enabled.includes('events'),
    notifications: {
      mode: channelOf(config),
      // What is saved for a channel is kept when another one is chosen: switching back finds it again.
      hasDiscordWebhook: Boolean(setting('DISCORD_WEBHOOK_URL')),
      hasSlackWebhook: Boolean(setting('SLACK_WEBHOOK_URL')),
      smtp: {
        host: setting('SMTP_HOST') ?? '',
        port: setting('SMTP_PORT') ?? '587',
        user: setting('SMTP_USER') ?? '',
        from: setting('SMTP_FROM') ?? '',
        hasPassword: Boolean(setting('SMTP_PASSWORD')),
      },
    },
  };
}

export interface EventsSettingsView {
  categories: EventCategory[];
  /** How many events each category (by key) is the category of: what a removal has to move. */
  usage: Record<string, number>;
  reminderHour: number;
  timezone: string;
}

/** What only the settings page shows, besides the forms it shares with the installer. */
export interface SettingsExtras {
  logo: { path: string; custom: boolean };
  /** Null while the events module is off: there is nothing to set. */
  events: EventsSettingsView | null;
}

export async function settingsExtras(): Promise<SettingsExtras> {
  const config = getConfig();
  const logo = { path: config.bde.logoPath, custom: logoVersionOf(config.bde.logoPath) !== null };
  if (!config.events || !config.modules.enabled.includes(EVENTS_MODULE_KEY)) {
    return { logo, events: null };
  }

  const counts = await prisma.event.groupBy({ by: ['categoryKey'], _count: { _all: true } });
  return {
    logo,
    events: {
      categories: config.events.categories,
      usage: Object.fromEntries(counts.map((row) => [row.categoryKey, row._count._all])),
      reminderHour: config.events.reminderHour,
      timezone: config.bde.timezone,
    },
  };
}

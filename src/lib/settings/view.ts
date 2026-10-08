import { getConfig } from '@/config';
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

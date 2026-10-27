import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { deliver } from '@/lib/notifications/deliver';
import { emailsOfOwners } from '@/lib/notifications/recipients';
import { withRichMessage } from '@/lib/notifications/rich';
import { templatesFor } from '@/lib/notifications/templates/resolve';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { registeredAddress } from '@/lib/public-address';
import { buildBackupEmbed } from './discord-embed';
import { buildBackupEmail } from './email';
import { describeFacts, type BackupSituation } from './facts';
import { buildBackupMessage } from './messages';
import { buildBackupSlack } from './slack-blocks';
import { backupAbove } from './template-values';

const LOG_PREFIX = '[backups]';

export type BackupNotification = 'backupFailed' | 'backupStale';

/**
 * Tells the owners that the backups do not work: the nightly backup failed (`backupFailed`), or none has succeeded for two days
 * (`backupStale`). By e-mail to every owner and in the BDE's room, on the channels the owners chose (none by default). Best-effort like every
 * notification: it never throws, and a failed send is only logged.
 */
export async function notifyBackups(
  type: BackupNotification,
  situation: BackupSituation,
): Promise<void> {
  try {
    const config = getConfig();
    if (channelsFor(config, type).length === 0) return;

    const locale = config.bde.defaultLocale;
    const kind = type === 'backupFailed' ? 'failed' : 'stale';
    const t = await getNotificationTranslate(locale, 'backups.notifications');
    const reasons = await getNotificationTranslate(locale, 'settings.backups.reasons');
    const facts = describeFacts(situation, { locale, timeZone: config.bde.timezone, t, reasons });
    const base = registeredAddress();
    const settingsUrl = base ? `${base}/${locale}/settings` : null;
    const templates = await templatesFor(type);

    const message = await withRichMessage(
      type,
      buildBackupMessage(kind, facts, config.bde.name, t, settingsUrl),
      {
        discord: () =>
          templates.build('discord', (context) =>
            buildBackupEmbed(kind, facts, t, settingsUrl, undefined, context),
          ),
        discordAbove: () =>
          templates.build('discord', (context) =>
            backupAbove('discord', facts, settingsUrl, context),
          ),
        email: (brand) =>
          templates.build('email', (context) =>
            buildBackupEmail(kind, facts, t, settingsUrl, brand, locale, context),
          ),
        slack: (brand) =>
          templates.build('slack', (context) =>
            buildBackupSlack(kind, facts, t, settingsUrl, brand, context),
          ),
      },
    );
    await deliver(type, message, await emailsOfOwners(), LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} ${type}: notification failed`, error);
  }
}

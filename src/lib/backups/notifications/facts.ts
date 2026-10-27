import type { Translate } from '@/lib/notifications/translate';
import { formatSize } from '../format';
import type { FailureCode } from '../status';

/**
 * What a notification about the backups says, as plain text ready to be put in a card, a message or an e-mail. Made once, in the
 * language of the BDE, from what the platform knows (`BackupSituation`), so that the three channels and the editor's example say the
 * same thing.
 */
export interface BackupFacts {
  /** Why the last attempt failed, as a sentence ("There is not enough room on the disk of the backups."); empty when it is not known. */
  reason: string;
  /** The last backup that passed its check ("27 Oct 2026, 03:00 · 108 kB"), or the word for none. */
  last: string;
  /** Whole days without a backup that passed. */
  days: number;
}

/** What the platform knows when it has to tell the owners. */
export interface BackupSituation {
  reasonCode: FailureCode | null;
  lastAt: Date | null;
  lastBytes: number | null;
  days: number;
}

const upperFirst = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export function describeFacts(
  situation: BackupSituation,
  options: {
    locale: string;
    timeZone: string;
    /** The `backups.notifications` namespace. */
    t: Translate;
    /** The `settings.backups.reasons` namespace: the sentences that say why a backup fails. */
    reasons: Translate;
  },
): BackupFacts {
  const { locale, timeZone, t, reasons } = options;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  return {
    reason: situation.reasonCode ? upperFirst(reasons(situation.reasonCode)) : '',
    last: situation.lastAt
      ? situation.lastBytes
        ? t('last.format', {
            date: when.format(situation.lastAt),
            size: formatSize(situation.lastBytes, locale),
          })
        : when.format(situation.lastAt)
      : t('last.none'),
    days: situation.days,
  };
}

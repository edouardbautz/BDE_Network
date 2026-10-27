import type { Translate } from '@/lib/notifications/translate';
import type { BackupFacts } from './facts';
import type { BackupCardKind } from './template-values';

/** What a notification about the backups says in plain text, and what every channel falls back to. `t` is the `backups.notifications` namespace. */
export interface BuiltMessage {
  subject: string;
  body: string;
}

export function buildBackupMessage(
  kind: BackupCardKind,
  facts: BackupFacts,
  bdeName: string,
  t: Translate,
  link: string | null,
): BuiltMessage {
  const lines =
    kind === 'failed'
      ? [t('embed.description.failed')]
      : [t('embed.description.stale', { days: facts.days })];
  if (facts.reason) lines.push(`${t('embed.fields.reason')} : ${facts.reason}`);
  lines.push(`${t('embed.fields.last')} : ${facts.last}`);
  if (link) lines.push(`${t('action')} : ${link}`);
  return {
    subject: t(`${kind}.subject`, { bde: bdeName, days: facts.days }),
    body: lines.join('\n'),
  };
}

import {
  renderAbove,
  type MentionPlatform,
  type RenderedAbove,
} from '@/lib/notifications/templates/mentions';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import type { BackupFacts } from './facts';

/** The type of notification a kind of backup card belongs to: the key of `notifications` in the configuration. */
export type BackupCardKind = 'failed' | 'stale';

export function backupTemplateType(kind: BackupCardKind): 'backupFailed' | 'backupStale' {
  return kind === 'failed' ? 'backupFailed' : 'backupStale';
}

/** What each `{variable}` of a template about the backups stands for. Plain text; what is absent is an empty string. */
export function backupValues(
  facts: BackupFacts,
  bdeName = '',
  link: string | null = null,
): Record<string, string> {
  return {
    reason: facts.reason,
    last: facts.last,
    days: String(facts.days),
    bde: bdeName,
    link: link ?? '',
  };
}

/** The message above the card for one platform, when the template has one: the only text that may ping. */
export function backupAbove(
  platform: MentionPlatform,
  facts: BackupFacts,
  link: string | null,
  context: TemplateContext,
): RenderedAbove | undefined {
  return renderAbove(
    context.template?.above,
    backupValues(facts, context.bdeName, link),
    platform,
    context.mentions,
  );
}

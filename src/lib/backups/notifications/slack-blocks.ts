import { BACKUP_COLORS, normalizeHex } from '@/lib/notifications/colors';
import type { EmailModel } from '@/lib/notifications/email-layout';
import { neutralizeForSlack } from '@/lib/notifications/sanitize';
import {
  slackButton,
  slackFooter,
  type SlackBlock,
  type SlackPayload,
} from '@/lib/notifications/slack-blocks';
import { resolveItems, withEmoji } from '@/lib/notifications/templates/apply';
import { renderPlain, renderSegments, toSlack } from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { truncate } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { BackupFacts } from './facts';
import {
  backupAbove,
  backupTemplateType,
  backupValues,
  type BackupCardKind,
} from './template-values';

const text = (value: string, max: number) => neutralizeForSlack(truncate(value, max));

/**
 * A notification about the backups as a Slack message, the colour of its kind (red, amber), the sentence, the reason and the last good backup
 * as columns, and a button to the page where the backups are. `t` is the `backups.notifications` namespace; `context.template` changes
 * what the BDE wants different.
 */
export function buildBackupSlack(
  kind: BackupCardKind,
  facts: BackupFacts,
  t: Translate,
  settingsUrl: string | null,
  brand: EmailModel['brand'],
  context: TemplateContext = {},
): SlackPayload {
  const { template } = context;
  const values = backupValues(facts, context.bdeName ?? brand.name, settingsUrl);
  const say = (source: string) => renderPlain(source, values);

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [];
  const top: SlackBlock[] = [];

  for (const item of resolveItems(template, 'slack', backupTemplateType(kind))) {
    const column = (fallback: string, value: string | null | undefined) => {
      if (value) {
        const label = withEmoji(item.emoji, say(item.label ?? fallback));
        fields.push({ type: 'mrkdwn', text: `*${label}*\n${text(value, 400)}` });
      }
    };
    switch (item.id) {
      case 'summary': {
        const sentence =
          item.text !== undefined
            ? toSlack(renderSegments(item.text, values)).trim()
            : t(`embed.description.${kind}`, { days: facts.days });
        if (sentence) top.push({ type: 'section', text: { type: 'mrkdwn', text: sentence } });
        break;
      }
      case 'failure':
        column(t('embed.fields.reason'), facts.reason);
        break;
      case 'lastBackup':
        column(t('embed.fields.last'), facts.last);
        break;
      default:
        if (item.custom && item.text) {
          const written = toSlack(renderSegments(item.text, values)).trim();
          if (written) top.push({ type: 'section', text: { type: 'mrkdwn', text: written } });
        }
    }
  }

  const kindLabel = say(template?.eyebrow ?? t(`embed.kind.${kind}`));
  const title = say(template?.title ?? t(`embed.title.${kind}`));
  const buttonUrl = template?.button?.url ?? settingsUrl;
  const showButton = (template?.button?.enabled ?? true) && buttonUrl;
  const buttonLabel = say(template?.button?.label ?? t('action'));

  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${kindLabel}*` }] },
    {
      type: 'header',
      text: { type: 'plain_text', text: template?.emoji ? `${template.emoji}  ${title}` : title },
    },
    ...top,
    ...(fields.length > 0 ? [{ type: 'section', fields } as SlackBlock] : []),
    ...(showButton ? [slackButton(buttonLabel, buttonUrl)] : []),
    slackFooter(brand, template?.footer !== undefined ? say(template.footer) : undefined),
  ];

  const above = backupAbove('slack', facts, settingsUrl, context);
  return {
    fallback: `${kindLabel} : ${truncate(title, 120)}`,
    color: normalizeHex(template?.color ?? `#${BACKUP_COLORS[kind].toString(16).padStart(6, '0')}`),
    ...(above && { above: above.text }),
    blocks,
  };
}

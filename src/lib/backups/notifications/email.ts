import { BACKUP_COLORS } from '@/lib/notifications/colors';
import { renderEmail, type EmailModel } from '@/lib/notifications/email-layout';
import { resolveItems, withEmoji } from '@/lib/notifications/templates/apply';
import {
  renderPlain,
  renderSegments,
  toPlainText,
  type Segment,
} from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import type { Translate } from '@/lib/notifications/translate';
import type { EmailContent } from '@/lib/notifications/types';
import type { BackupFacts } from './facts';
import { backupTemplateType, backupValues, type BackupCardKind } from './template-values';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/**
 * A notification about the backups as a designed e-mail for the owners: the sentence, the reason and the last good backup in a table,
 * and a button to the page where the backups are. `context.template` changes what the BDE wants different.
 */
export function buildBackupEmail(
  kind: BackupCardKind,
  facts: BackupFacts,
  t: Translate,
  settingsUrl: string | null,
  brand: EmailModel['brand'],
  locale: string,
  context: TemplateContext = {},
): EmailContent {
  const { template } = context;
  const values = backupValues(facts, context.bdeName ?? brand.name, settingsUrl);
  const say = (source: string) => renderPlain(source, values);
  const sentence = t(`embed.description.${kind}`, { days: facts.days });

  let lead: string | undefined;
  const paragraphs: Segment[][] = [];
  const fields: EmailModel['fields'] = [];
  for (const item of resolveItems(template, 'email', backupTemplateType(kind))) {
    const label = (fallback: string) => withEmoji(item.emoji, say(item.label ?? fallback));
    switch (item.id) {
      case 'summary':
        lead ??=
          item.text !== undefined
            ? toPlainText(renderSegments(item.text, values)).trim()
            : sentence;
        break;
      case 'failure':
        if (facts.reason)
          fields.push({ label: label(t('embed.fields.reason')), value: facts.reason });
        break;
      case 'lastBackup':
        fields.push({ label: label(t('embed.fields.last')), value: facts.last });
        break;
      default:
        if (item.custom && item.text) {
          const segments = renderSegments(item.text, values);
          if (toPlainText(segments).trim()) paragraphs.push(segments);
        }
    }
  }

  const buttonUrl = template?.button?.url ?? settingsUrl;
  const showButton = (template?.button?.enabled ?? true) && buttonUrl;
  const rendered = renderEmail({
    lang: locale,
    preheader: template?.preheader !== undefined ? say(template.preheader) : (lead ?? sentence),
    brand,
    accent: template?.color ?? hex(BACKUP_COLORS[kind]),
    eyebrow: say(template?.eyebrow ?? t(`embed.kind.${kind}`)),
    heading: say(template?.title ?? t(`embed.title.${kind}`)),
    ...(lead && { lead }),
    ...(paragraphs.length > 0 && { paragraphs }),
    fields,
    ...(showButton && {
      action: { label: say(template?.button?.label ?? t('action')), url: buttonUrl },
    }),
    ...(template?.note !== undefined && template.note !== '' && { note: say(template.note) }),
    footer:
      template?.footer !== undefined
        ? say(template.footer)
        : t('email.footer', { bde: brand.name }),
  });

  return {
    ...rendered,
    ...(template?.subject !== undefined && { subject: say(template.subject) }),
  };
}

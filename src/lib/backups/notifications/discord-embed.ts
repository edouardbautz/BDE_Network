import { BACKUP_COLORS, colorToInt } from '@/lib/notifications/colors';
import {
  BLANK_LINE,
  kindLine,
  quoteBlock,
  type DiscordEmbed,
  type DiscordEmbedField,
} from '@/lib/notifications/discord-embed';
import { PLATFORM_NAME } from '@/lib/notifications/platform';
import { resolveItems } from '@/lib/notifications/templates/apply';
import { renderPlain, renderSegments, toDiscord } from '@/lib/notifications/templates/text';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import { httpUrl } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { BackupFacts } from './facts';
import { backupTemplateType, backupValues, type BackupCardKind } from './template-values';

export const KIND_ICON: Record<BackupCardKind, string> = {
  failed: '🚨',
  stale: '⏰',
};
export const ICON = {
  reason: '🔎',
  last: '💾',
  action: '👉',
};

/** A name with its emoji in front, two spaces between (Discord's own rhythm); no emoji, no space. */
const named = (emoji: string, label: string) => (emoji ? `${emoji}  ${label}` : label);

/**
 * A notification about the backups as a Discord card, laid out like the others: the kind in capitals, the sentence as a quote, the reason
 * and the last good backup as fields, and a link to the page where the backups are. Red when the backup failed, amber when none has
 * succeeded for two days. `context.template` changes what the BDE wants different; without it the card is the platform's own.
 */
export function buildBackupEmbed(
  kind: BackupCardKind,
  facts: BackupFacts,
  t: Translate,
  settingsUrl: string | null,
  now: Date = new Date(),
  context: TemplateContext = {},
): DiscordEmbed {
  const { template } = context;
  const values = backupValues(facts, context.bdeName, settingsUrl);
  const say = (text: string) => renderPlain(text, values);
  const field = (name: string, value: string | null | undefined): DiscordEmbedField[] =>
    value ? [{ name, value, inline: false }] : [];

  const fields: DiscordEmbedField[] = [];
  const blocks: string[][] = [];

  for (const item of resolveItems(template, 'discord', backupTemplateType(kind))) {
    const label = (fallback: string) => say(item.label ?? fallback);
    const emoji = (fallback: string) => item.emoji ?? fallback;
    switch (item.id) {
      case 'summary': {
        const sentence =
          item.text !== undefined
            ? toDiscord(renderSegments(item.text, values)).trim()
            : t(`embed.description.${kind}`, { days: facts.days });
        if (sentence) blocks.push([quoteBlock(sentence)]);
        break;
      }
      case 'failure':
        fields.push(
          ...field(named(emoji(ICON.reason), label(t('embed.fields.reason'))), facts.reason),
        );
        break;
      case 'lastBackup':
        fields.push(...field(named(emoji(ICON.last), label(t('embed.fields.last'))), facts.last));
        break;
      default:
        if (item.custom && item.text) {
          const text = toDiscord(renderSegments(item.text, values)).trim();
          if (text) blocks.push([text]);
        }
    }
  }

  const link = httpUrl(settingsUrl);
  const buttonLink = httpUrl(template?.button?.url ?? settingsUrl);
  if ((template?.button?.enabled ?? true) && buttonLink) {
    // A closing parenthesis would end the link early.
    const buttonLabel = say(template?.button?.label ?? t('action'));
    blocks.push([`${ICON.action}  [${buttonLabel}](${buttonLink.replace(/\)/g, '%29')})`]);
  }

  const lines: string[] = [kindLine(say(template?.eyebrow ?? t(`embed.kind.${kind}`))), BLANK_LINE];
  blocks.forEach((block, index) => {
    if (index > 0) lines.push(BLANK_LINE);
    lines.push(...block);
  });
  if (fields.length > 0) lines.push(BLANK_LINE); // air between the text and the fields

  return {
    title: named(
      template?.emoji ?? KIND_ICON[kind],
      say(template?.title ?? t(`embed.title.${kind}`)),
    ),
    url: link,
    color: template?.color ? colorToInt(template.color) : BACKUP_COLORS[kind],
    description: lines.join('\n'),
    ...(fields.length > 0 && { fields }),
    footer: { text: template?.footer !== undefined ? say(template.footer) : PLATFORM_NAME },
    timestamp: now.toISOString(),
  };
}

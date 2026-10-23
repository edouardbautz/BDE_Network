import { MEMBER_COLORS, normalizeHex } from '@/lib/notifications/colors';
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
import type { MemberFacts } from './messages';
import { memberTemplateType, memberValues } from './template-values';

export type MemberSlackKind = 'pending' | 'approved' | 'removed';

const text = (value: string, max: number) => neutralizeForSlack(truncate(value, max));

/**
 * A member notification as a Slack message: a colour per kind (amber for a request waiting, green
 * for an approval, red for a removal, the same as on Discord), the person's 42 photo beside what
 * happened, their login and campus in columns, the role and who did it, and for a request a button to
 * the page where it is decided. `t` is the `members.notifications` namespace.
 *
 * `context.template` changes what the BDE wants different (texts, colour, which facts and in which order, the button);
 * without it the message is the one the platform has always sent.
 */
export function buildMemberSlack(
  kind: MemberSlackKind,
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  brand: EmailModel['brand'],
  context: TemplateContext = {},
): SlackPayload {
  const { template } = context;
  const values = memberValues(member, context.bdeName ?? brand.name, membersUrl);
  const say = (source: string) => renderPlain(source, values);

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [];
  const top: SlackBlock[] = [];

  for (const item of resolveItems(template, 'slack', memberTemplateType(kind))) {
    const column = (fallback: string, value: string | null | undefined) => {
      if (value) {
        const label = withEmoji(item.emoji, say(item.label ?? fallback));
        fields.push({
          type: 'mrkdwn',
          text: `*${label}*
${text(value, 400)}`,
        });
      }
    };
    switch (item.id) {
      case 'summary': {
        const sentence =
          item.text !== undefined
            ? toSlack(renderSegments(item.text, values)).trim()
            : t(`embed.description.${kind}`, { name: text(member.fullName, 120) });
        if (sentence) {
          top.push({
            type: 'section',
            text: { type: 'mrkdwn', text: sentence },
            ...(member.photoUrl && {
              accessory: { type: 'image', image_url: member.photoUrl, alt_text: member.fullName },
            }),
          });
        }
        break;
      }
      case 'login':
        column(t('embed.fields.login'), member.login);
        break;
      case 'campus':
        column(t('embed.fields.campus'), member.campus);
        break;
      case 'role':
        // What the member holds (or held): only once there is a role to speak of.
        if (kind !== 'pending') column(t('embed.fields.role'), member.roleName);
        break;
      case 'actedBy':
        if (kind === 'approved') column(t('embed.fields.approvedBy'), member.actorName);
        if (kind === 'removed') column(t('embed.fields.removedBy'), member.actorName);
        break;
      default:
        if (item.custom && item.text) {
          const written = toSlack(renderSegments(item.text, values)).trim();
          if (written) top.push({ type: 'section', text: { type: 'mrkdwn', text: written } });
        }
    }
  }

  const kindLabel = say(template?.eyebrow ?? t(`embed.kind.${kind}`));
  const title = say(template?.title ?? '{name}');
  const showButton = (template?.button?.enabled ?? kind === 'pending') && membersUrl;
  const buttonLabel = say(
    template?.button?.label ??
      t(kind === 'pending' ? 'slack.pendingAction' : 'embed.action.members'),
  );

  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${kindLabel}*` }] },
    {
      type: 'header',
      text: { type: 'plain_text', text: template?.emoji ? `${template.emoji}  ${title}` : title },
    },
    ...top,
    { type: 'section', fields },
    ...(showButton ? [slackButton(buttonLabel, membersUrl)] : []),
    slackFooter(brand, template?.footer !== undefined ? say(template.footer) : undefined),
  ];

  return {
    fallback: `${kindLabel} : ${truncate(title, 120)}`,
    color: normalizeHex(template?.color ?? `#${MEMBER_COLORS[kind].toString(16).padStart(6, '0')}`),
    blocks,
  };
}

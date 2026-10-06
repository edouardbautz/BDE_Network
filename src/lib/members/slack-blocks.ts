import { MEMBER_COLORS, normalizeHex } from '@/lib/notifications/colors';
import type { EmailModel } from '@/lib/notifications/email-layout';
import { neutralizeForSlack } from '@/lib/notifications/sanitize';
import {
  slackButton,
  slackFooter,
  type SlackBlock,
  type SlackPayload,
} from '@/lib/notifications/slack-blocks';
import { truncate } from '@/lib/notifications/text';
import type { Translate } from '@/lib/notifications/translate';
import type { MemberFacts } from './messages';

export type MemberSlackKind = 'pending' | 'approved' | 'removed';

const text = (value: string, max: number) => neutralizeForSlack(truncate(value, max));

/**
 * A member notification as a Slack message: a colour per kind (amber for a request waiting, green
 * for an approval, red for a removal, the same as on Discord), the person's 42 photo beside what
 * happened, their login and campus in columns, the role and who did it, and for a request a button to
 * the page where it is decided. `t` is the `members.notifications` namespace.
 */
export function buildMemberSlack(
  kind: MemberSlackKind,
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  brand: EmailModel['brand'],
): SlackPayload {
  const column = (label: string, value: string | null | undefined) =>
    value ? [{ type: 'mrkdwn' as const, text: `*${label}*\n${text(value, 400)}` }] : [];

  const fields = [
    ...column(t('embed.fields.login'), member.login),
    ...column(t('embed.fields.campus'), member.campus),
    // What the member holds (or held): only once there is a role to speak of.
    ...(kind === 'pending' ? [] : column(t('embed.fields.role'), member.roleName)),
    ...(kind === 'approved' ? column(t('embed.fields.approvedBy'), member.actorName) : []),
    ...(kind === 'removed' ? column(t('embed.fields.removedBy'), member.actorName) : []),
  ];

  const kindLabel = t(`embed.kind.${kind}`);
  const sentence = t(`embed.description.${kind}`, { name: text(member.fullName, 120) });

  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${kindLabel}*` }] },
    { type: 'header', text: { type: 'plain_text', text: member.fullName } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: sentence },
      ...(member.photoUrl && {
        accessory: { type: 'image', image_url: member.photoUrl, alt_text: member.fullName },
      }),
    },
    { type: 'section', fields },
    ...(kind === 'pending' && membersUrl
      ? [slackButton(t('slack.pendingAction'), membersUrl)]
      : []),
    slackFooter(brand),
  ];

  return {
    fallback: `${kindLabel} : ${truncate(member.fullName, 120)}`,
    color: normalizeHex(`#${MEMBER_COLORS[kind].toString(16).padStart(6, '0')}`),
    blocks,
  };
}

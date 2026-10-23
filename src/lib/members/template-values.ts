import {
  renderAbove,
  type MentionPlatform,
  type RenderedAbove,
} from '@/lib/notifications/templates/mentions';
import type { TemplateContext } from '@/lib/notifications/templates/types';
import type { MemberFacts } from './messages';

/** The type of notification a kind of member card belongs to: the key of `notifications` in the configuration. */
export function memberTemplateType(
  kind: 'pending' | 'approved' | 'removed',
): 'memberPending' | 'memberApproved' | 'memberRemoved' {
  return kind === 'pending'
    ? 'memberPending'
    : kind === 'approved'
      ? 'memberApproved'
      : 'memberRemoved';
}

/**
 * What each `{variable}` of a member's template stands for. Plain text; what is absent is an empty string.
 * `role` is the role held (or just given) and `actor` who approved or removed the member.
 */
export function memberValues(
  member: MemberFacts,
  bdeName = '',
  link: string | null = null,
): Record<string, string> {
  return {
    name: member.fullName,
    login: member.login,
    campus: member.campus ?? '',
    role: member.roleName ?? '',
    actor: member.actorName ?? '',
    bde: bdeName,
    link: link ?? '',
  };
}

/** The message above the card of a member notification for one platform, when the template has one: the only text that may ping. */
export function memberAbove(
  platform: MentionPlatform,
  member: MemberFacts,
  link: string | null,
  context: TemplateContext,
): RenderedAbove | undefined {
  return renderAbove(
    context.template?.above,
    memberValues(member, context.bdeName, link),
    platform,
    context.mentions,
  );
}

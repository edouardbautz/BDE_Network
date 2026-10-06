import type { Translate } from '@/lib/notifications/translate';

/** What a member notification says. `t` is the `members.notifications` namespace. */

export interface BuiltMessage {
  subject: string;
  body: string;
}

export interface MemberFacts {
  login: string;
  fullName: string;
  campus?: string | null;
  /** The 42 profile picture, shown as the thumbnail of the Discord card. */
  photoUrl?: string | null;
  /** The role held (or just given). */
  roleName?: string | null;
  /** Who approved or removed them, by name; the Discord card says it. */
  actorName?: string | null;
}

/** Someone asks for access: written for the people who can approve. */
export function buildPendingMessage(
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
): BuiltMessage {
  const lines = [
    t('pending.intro', {
      name: member.fullName,
      login: member.login,
      campus: member.campus ?? '',
    }),
  ];
  if (membersUrl) lines.push(`${t('pending.link')} : ${membersUrl}`);
  return { subject: t('pending.subject', { name: member.fullName }), body: lines.join('\n') };
}

/** The member is approved. By email it speaks to them; on a chat channel it informs the team. */
export function buildApprovedMessage(
  member: MemberFacts,
  roleName: string,
  audience: 'member' | 'team',
  t: Translate,
  appUrl: string | null,
  bdeName: string,
): BuiltMessage {
  if (audience === 'member') {
    const lines = [
      t('approved.memberIntro', { name: member.fullName }),
      t('approved.memberRole', { role: roleName }),
    ];
    if (appUrl) lines.push(`${t('approved.memberLink')} : ${appUrl}`);
    return { subject: t('approved.memberSubject', { bde: bdeName }), body: lines.join('\n') };
  }

  return {
    subject: t('approved.teamSubject', { name: member.fullName }),
    body: t('approved.teamBody', { name: member.fullName, login: member.login, role: roleName }),
  };
}

/** A member was removed: only ever sent to the team's channel. */
export function buildRemovedMessage(member: MemberFacts, t: Translate): BuiltMessage {
  return {
    subject: t('removed.subject', { name: member.fullName }),
    body: t('removed.body', { name: member.fullName, login: member.login }),
  };
}

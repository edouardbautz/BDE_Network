import { MEMBER_COLORS } from '@/lib/notifications/discord-embed';
import { renderEmail, type EmailModel } from '@/lib/notifications/email-layout';
import type { Translate } from '@/lib/notifications/translate';
import type { EmailContent } from '@/lib/notifications/types';
import type { MemberFacts } from './messages';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Someone asks for access: written for the people who can approve, with a button to the page where
 * they decide. `t` is the `members.notifications` namespace. */
export function buildPendingEmail(
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  brand: EmailModel['brand'],
  locale: string,
): EmailContent {
  const lead = t('embed.description.pending', { name: member.fullName });
  const fields: EmailModel['fields'] = [{ label: t('embed.fields.login'), value: member.login }];
  if (member.campus) fields.push({ label: t('embed.fields.campus'), value: member.campus });

  return renderEmail({
    lang: locale,
    preheader: lead,
    brand,
    accent: hex(MEMBER_COLORS.pending),
    eyebrow: t('embed.kind.pending'),
    heading: member.fullName,
    lead,
    ...(member.photoUrl && { avatarUrl: member.photoUrl }),
    fields,
    ...(membersUrl && { action: { label: t('pending.link'), url: membersUrl } }),
    footer: t('email.footerApprovers', { bde: brand.name }),
  });
}

/** The approved member's own e-mail: welcome, the role they hold, a button to sign in. */
export function buildApprovedEmail(
  member: MemberFacts,
  roleName: string,
  t: Translate,
  appUrl: string | null,
  brand: EmailModel['brand'],
  locale: string,
): EmailContent {
  const lead = t('approved.memberIntro', { name: member.fullName });

  return renderEmail({
    lang: locale,
    preheader: lead,
    brand,
    accent: hex(MEMBER_COLORS.approved),
    eyebrow: t('embed.kind.approved'),
    heading: t('approved.memberSubject', { bde: brand.name }),
    lead,
    fields: [{ label: t('embed.fields.role'), value: roleName }],
    ...(appUrl && { action: { label: t('approved.memberLink'), url: appUrl } }),
    footer: t('email.footerRequester', { bde: brand.name }),
  });
}

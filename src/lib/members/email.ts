import { MEMBER_COLORS } from '@/lib/notifications/colors';
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
import type { MemberFacts } from './messages';
import { memberTemplateType, memberValues } from './template-values';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Someone asks for access: written for the people who can approve, with a button to the page where
 * they decide. `t` is the `members.notifications` namespace. `context.template` changes what the BDE wants different. */
export function buildPendingEmail(
  member: MemberFacts,
  t: Translate,
  membersUrl: string | null,
  brand: EmailModel['brand'],
  locale: string,
  context: TemplateContext = {},
): EmailContent {
  const { template } = context;
  const values = memberValues(member, context.bdeName ?? brand.name, membersUrl);
  const say = (source: string) => renderPlain(source, values);

  let lead: string | undefined;
  const paragraphs: Segment[][] = [];
  const fields: EmailModel['fields'] = [];
  for (const item of resolveItems(template, 'email', memberTemplateType('pending'))) {
    const label = (fallback: string) => withEmoji(item.emoji, say(item.label ?? fallback));
    switch (item.id) {
      case 'summary':
        lead ??=
          item.text !== undefined
            ? toPlainText(renderSegments(item.text, values)).trim()
            : t('embed.description.pending', { name: member.fullName });
        break;
      case 'login':
        fields.push({ label: label(t('embed.fields.login')), value: member.login });
        break;
      case 'campus':
        if (member.campus)
          fields.push({ label: label(t('embed.fields.campus')), value: member.campus });
        break;
      default:
        if (item.custom && item.text) {
          const segments = renderSegments(item.text, values);
          if (toPlainText(segments).trim()) paragraphs.push(segments);
        }
    }
  }

  const showButton = (template?.button?.enabled ?? true) && membersUrl;
  const rendered = renderEmail({
    lang: locale,
    preheader:
      template?.preheader !== undefined
        ? say(template.preheader)
        : (lead ?? t('embed.description.pending', { name: member.fullName })),
    brand,
    accent: template?.color ?? hex(MEMBER_COLORS.pending),
    eyebrow: say(template?.eyebrow ?? t('embed.kind.pending')),
    heading: say(template?.title ?? '{name}'),
    ...(lead && { lead }),
    ...(paragraphs.length > 0 && { paragraphs }),
    ...(member.photoUrl && { avatarUrl: member.photoUrl }),
    fields,
    ...(showButton && {
      action: { label: say(template?.button?.label ?? t('pending.link')), url: membersUrl },
    }),
    ...(template?.note !== undefined && template.note !== '' && { note: say(template.note) }),
    footer:
      template?.footer !== undefined
        ? say(template.footer)
        : t('email.footerApprovers', { bde: brand.name }),
  });

  return {
    ...rendered,
    ...(template?.subject !== undefined && { subject: say(template.subject) }),
  };
}

/** The approved member's own e-mail: welcome, the role they hold, a button to sign in. */
export function buildApprovedEmail(
  member: MemberFacts,
  roleName: string,
  t: Translate,
  appUrl: string | null,
  brand: EmailModel['brand'],
  locale: string,
  context: TemplateContext = {},
): EmailContent {
  const { template } = context;
  const values = memberValues({ ...member, roleName }, context.bdeName ?? brand.name, appUrl);
  const say = (source: string) => renderPlain(source, values);

  let lead: string | undefined;
  const paragraphs: Segment[][] = [];
  const fields: EmailModel['fields'] = [];
  for (const item of resolveItems(template, 'email', memberTemplateType('approved'))) {
    switch (item.id) {
      case 'summary':
        lead ??=
          item.text !== undefined
            ? toPlainText(renderSegments(item.text, values)).trim()
            : t('approved.memberIntro', { name: member.fullName });
        break;
      case 'role':
        fields.push({
          label: withEmoji(item.emoji, say(item.label ?? t('embed.fields.role'))),
          value: roleName,
        });
        break;
      default:
        if (item.custom && item.text) {
          const segments = renderSegments(item.text, values);
          if (toPlainText(segments).trim()) paragraphs.push(segments);
        }
    }
  }

  const subject =
    template?.subject !== undefined
      ? say(template.subject)
      : t('approved.memberSubject', { bde: brand.name });
  const showButton = (template?.button?.enabled ?? true) && appUrl;

  return {
    ...renderEmail({
      lang: locale,
      preheader:
        template?.preheader !== undefined
          ? say(template.preheader)
          : (lead ?? t('approved.memberIntro', { name: member.fullName })),
      brand,
      accent: template?.color ?? hex(MEMBER_COLORS.approved),
      eyebrow: say(template?.eyebrow ?? t('embed.kind.approved')),
      heading:
        template?.title !== undefined
          ? say(template.title)
          : t('approved.memberSubject', { bde: brand.name }),
      ...(lead && { lead }),
      ...(paragraphs.length > 0 && { paragraphs }),
      fields,
      ...(showButton && {
        action: { label: say(template?.button?.label ?? t('approved.memberLink')), url: appUrl },
      }),
      ...(template?.note !== undefined && template.note !== '' && { note: say(template.note) }),
      footer:
        template?.footer !== undefined
          ? say(template.footer)
          : t('email.footerRequester', { bde: brand.name }),
    }),
    // The mail speaks to the member; the chat channels, from the same notification, inform the team.
    subject,
  };
}

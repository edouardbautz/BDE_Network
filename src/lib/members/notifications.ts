import { getConfig } from '@/config';
import { deliver } from '@/lib/notifications/deliver';
import { withRichMessage } from '@/lib/notifications/rich';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { emailsOfHolders } from '@/lib/notifications/recipients';
import { MEMBERS_MANAGE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { buildMemberEmbed } from './discord-embed';
import { buildApprovedEmail, buildPendingEmail } from './email';
import { buildMemberSlack } from './slack-blocks';
import {
  buildApprovedMessage,
  buildPendingMessage,
  buildRemovedMessage,
  type MemberFacts,
} from './messages';
import { setting } from '@/lib/settings/runtime';

/**
 * Notifications about members: a request waiting (`memberPending`), a member approved
 * (`memberApproved`) or removed (`memberRemoved`). All best-effort: they run after the response
 * (`after()` in the callers), never throw, and a failed send is only logged — approving or
 * removing someone cannot fail because a webhook or the SMTP server is down.
 */

const LOG_PREFIX = '[members]';

function translate(locale: string) {
  return getNotificationTranslate(locale, 'members.notifications');
}

/** Who did it, by name (the login when the account is gone or unknown). */
async function nameOf(login: string | undefined): Promise<string | null> {
  if (!login) return null;
  const user = await prisma.user.findUnique({ where: { login }, select: { fullName: true } });
  return user?.fullName ?? login;
}

/** Absolute link into the app, or null when APP_URL is not set. */
function appLink(locale: string, path = ''): string | null {
  const base = setting('APP_URL')?.trim().replace(/\/+$/, '');
  return base ? `${base}/${locale}${path}` : null;
}

/** Who did it, for the channels whose messages say so (the cards of Discord and Slack). */
function actorNameFor(channel: string, actorLogin: string | undefined): Promise<string | null> {
  return channel === 'discord' || channel === 'slack' ? nameOf(actorLogin) : Promise.resolve(null);
}

/** A new account is waiting for approval: tells whoever can approve it. */
export async function notifyMemberPending(userId: string): Promise<void> {
  try {
    const config = getConfig();
    if (config.notifications.memberPending === 'none') return;

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: { login: true, fullName: true, campus: true, photoUrl: true, status: true },
    });
    if (member?.status !== 'PENDING') return;

    const locale = config.bde.defaultLocale;
    const t = await translate(locale);
    const membersUrl = appLink(locale, '/members');
    const message = await withRichMessage(
      'memberPending',
      buildPendingMessage(member, t, membersUrl),
      {
        discord: () => buildMemberEmbed('pending', member, t, membersUrl),
        email: (brand) => buildPendingEmail(member, t, membersUrl, brand, locale),
        slack: (brand) => buildMemberSlack('pending', member, t, membersUrl, brand),
      },
    );
    await deliver('memberPending', message, await emailsOfHolders(MEMBERS_MANAGE), LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberPending: notification failed`, error);
  }
}

/** A request was approved: tells the member by email, or the team on a chat channel. */
export async function notifyMemberApproved(userId: string, actorLogin?: string): Promise<void> {
  try {
    const config = getConfig();
    const channel = config.notifications.memberApproved;
    if (channel === 'none') return;

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        login: true,
        fullName: true,
        email: true,
        campus: true,
        photoUrl: true,
        status: true,
        role: { select: { name: true } },
      },
    });
    if (member?.status !== 'MEMBER' || !member.role) return;

    const locale = config.bde.defaultLocale;
    const t = await translate(locale);
    const actorName = await actorNameFor(channel, actorLogin);
    const roleName = member.role.name;
    const facts = { ...member, roleName, actorName };
    const message = await withRichMessage(
      'memberApproved',
      buildApprovedMessage(
        member,
        roleName,
        channel === 'email' ? 'member' : 'team',
        t,
        appLink(locale),
        config.bde.name,
      ),
      {
        discord: () => buildMemberEmbed('approved', facts, t, appLink(locale, '/members')),
        email: (brand) => buildApprovedEmail(member, roleName, t, appLink(locale), brand, locale),
        slack: (brand) =>
          buildMemberSlack('approved', facts, t, appLink(locale, '/members'), brand),
      },
    );
    await deliver('memberApproved', message, [member.email], LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberApproved: notification failed`, error);
  }
}

/** A member was removed: a message in the team's chat channel, and nothing else. The removed
 * person is never emailed, so the `email` channel sends nothing for this event. */
export async function notifyMemberRemoved(member: MemberFacts, actorLogin?: string): Promise<void> {
  try {
    const config = getConfig();
    const channel = config.notifications.memberRemoved;
    if (channel === 'none' || channel === 'email') return;

    const t = await translate(config.bde.defaultLocale);
    const facts = { ...member, actorName: await actorNameFor(channel, actorLogin) };
    const message = await withRichMessage('memberRemoved', buildRemovedMessage(member, t), {
      discord: () => buildMemberEmbed('removed', facts, t, null),
      slack: (brand) => buildMemberSlack('removed', facts, t, null, brand),
    });
    await deliver('memberRemoved', message, [], LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberRemoved: notification failed`, error);
  }
}

import { getConfig } from '@/config';
import { deliver } from '@/lib/notifications/deliver';
import { getNotificationTranslate } from '@/lib/notifications/translate';
import { emailsOfHolders } from '@/lib/notifications/recipients';
import { MEMBERS_MANAGE } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  buildApprovedMessage,
  buildPendingMessage,
  buildRemovedMessage,
  type MemberFacts,
} from './messages';

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

/** Absolute link into the app, or null when APP_URL is not set. */
function appLink(locale: string, path = ''): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/${locale}${path}` : null;
}

/** A new account is waiting for approval: tells whoever can approve it. */
export async function notifyMemberPending(userId: string): Promise<void> {
  try {
    const config = getConfig();
    if (config.notifications.memberPending === 'none') return;

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: { login: true, fullName: true, campus: true, status: true },
    });
    if (member?.status !== 'PENDING') return;

    const locale = config.bde.defaultLocale;
    const message = buildPendingMessage(
      member,
      await translate(locale),
      appLink(locale, '/members'),
    );
    await deliver('memberPending', message, await emailsOfHolders(MEMBERS_MANAGE), LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberPending: notification failed`, error);
  }
}

/** A request was approved: tells the member by email, or the team on a chat channel. */
export async function notifyMemberApproved(userId: string): Promise<void> {
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
        status: true,
        role: { select: { name: true } },
      },
    });
    if (member?.status !== 'MEMBER' || !member.role) return;

    const locale = config.bde.defaultLocale;
    const message = buildApprovedMessage(
      member,
      member.role.name,
      channel === 'email' ? 'member' : 'team',
      await translate(locale),
      appLink(locale),
      config.bde.name,
    );
    await deliver('memberApproved', message, [member.email], LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberApproved: notification failed`, error);
  }
}

/** A member was removed: a message in the team's chat channel, and nothing else. The removed
 * person is never emailed, so the `email` channel sends nothing for this event. */
export async function notifyMemberRemoved(member: MemberFacts): Promise<void> {
  try {
    const config = getConfig();
    const channel = config.notifications.memberRemoved;
    if (channel === 'none' || channel === 'email') return;

    const message = buildRemovedMessage(member, await translate(config.bde.defaultLocale));
    await deliver('memberRemoved', message, [], LOG_PREFIX);
  } catch (error) {
    console.error(`${LOG_PREFIX} memberRemoved: notification failed`, error);
  }
}

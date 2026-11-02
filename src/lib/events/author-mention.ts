import type { StaffMentionIds } from '@/lib/notifications/templates/mentions';
import { prisma } from '@/lib/prisma';

/**
 * The ids `{@author}` stands for: the author of an event that came from a proposal, by the Discord and Slack ids they gave on their
 * profile (none when they gave none, or when the account is gone). One person at most, so the announcement can ping nobody else.
 */
export async function authorMentionIds(login: string): Promise<StaffMentionIds> {
  const user = await prisma.user.findUnique({
    where: { login },
    select: { discordUserId: true, slackUserId: true },
  });
  return {
    discord: user?.discordUserId ? [user.discordUserId] : [],
    slack: user?.slackUserId ? [user.slackUserId] : [],
  };
}

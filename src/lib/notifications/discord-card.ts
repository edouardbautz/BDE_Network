import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import type { DiscordEmbed } from './discord-embed';
import { discordSender } from './sender';
import type { NotificationMessage } from './types';

/**
 * Adds the Discord card to a notification, when (and only when) its channel is Discord: the
 * card, and the check of the BDE's logo that goes with it, cost nothing for email or Slack. The
 * plain `subject` and `body` stay, as the fallback of an adapter that cannot show cards.
 */
export async function withDiscordCard(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  card: () => DiscordEmbed,
): Promise<Omit<NotificationMessage, 'to'>> {
  if (getConfig().notifications[event] !== 'discord') {
    return message;
  }

  const { username, avatarUrl } = await discordSender();
  return { ...message, discord: { embeds: [card()], username, avatarUrl } };
}

import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import type { DiscordEmbed } from './discord-embed';
import { discordSender, type DiscordSender } from './sender';
import type { NotificationMessage } from './types';

/**
 * The BDE signs every card the same way, here rather than in each builder: its name and logo on the
 * line above the title, and its logo as the thumbnail of a card that has no picture of its own (an
 * event; a member keeps their 42 photo). The logo is only there when Discord can fetch it (see
 * sender.ts): without it the card has the name alone, never a broken picture.
 */
export function signCard(
  embed: DiscordEmbed,
  { username, avatarUrl }: DiscordSender,
): DiscordEmbed {
  return {
    ...embed,
    ...(username && { author: { name: username, ...(avatarUrl && { icon_url: avatarUrl }) } }),
    ...(avatarUrl && !embed.thumbnail && { thumbnail: { url: avatarUrl } }),
  };
}

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

  const sender = await discordSender();
  return {
    ...message,
    discord: {
      embeds: [signCard(card(), sender)],
      username: sender.username,
      avatarUrl: sender.avatarUrl,
    },
  };
}

import { fitEmbed } from '../discord-embed';
import { neutralizeEmbedForDiscord, neutralizeForDiscord } from '../sanitize';
import type { NotificationAdapter, NotificationMessage } from '../types';
import { setting } from '@/lib/settings/runtime';

/** Discord accepts up to ten cards in a message; the platform sends one. */
const MAX_EMBEDS = 10;

/** What is posted to the webhook for this message: cards when the notification has them, the
 * plain subject and body otherwise. Every text is made harmless first and cut to Discord's limits,
 * and the webhook never pings anyone whatever the text says. */
function payloadOf(message: NotificationMessage): Record<string, unknown> {
  const noMention = { parse: [] };

  if (message.discord && message.discord.embeds.length > 0) {
    const { embeds, username, avatarUrl } = message.discord;
    return {
      ...(username && { username: neutralizeForDiscord(username) }),
      ...(avatarUrl && { avatar_url: avatarUrl }),
      embeds: embeds
        .slice(0, MAX_EMBEDS)
        .map((embed) => fitEmbed(neutralizeEmbedForDiscord(embed))),
      allowed_mentions: noMention,
    };
  }

  return {
    content: `**${neutralizeForDiscord(message.subject)}**\n${neutralizeForDiscord(message.body)}`,
    // Whatever the text says, this webhook never pings anyone.
    allowed_mentions: noMention,
  };
}

export class DiscordAdapter implements NotificationAdapter {
  async send(message: NotificationMessage): Promise<void> {
    const webhookUrl = setting('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) {
      throw new Error(
        'DiscordAdapter: DISCORD_WEBHOOK_URL must be set in .env to send Discord notifications',
      );
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadOf(message)),
    });

    if (!response.ok) {
      throw new Error(`DiscordAdapter: webhook responded with ${response.status}`);
    }
  }
}

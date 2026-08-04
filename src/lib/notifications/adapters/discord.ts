import type { NotificationAdapter, NotificationMessage } from '../types';

export class DiscordAdapter implements NotificationAdapter {
  async send(message: NotificationMessage): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error(
        'DiscordAdapter: DISCORD_WEBHOOK_URL must be set in .env to send Discord notifications',
      );
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${message.subject}**\n${message.body}` }),
    });

    if (!response.ok) {
      throw new Error(`DiscordAdapter: webhook responded with ${response.status}`);
    }
  }
}

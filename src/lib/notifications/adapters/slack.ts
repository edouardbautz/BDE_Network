import type { NotificationAdapter, NotificationMessage } from '../types';

export class SlackAdapter implements NotificationAdapter {
  async send(message: NotificationMessage): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error(
        'SlackAdapter: SLACK_WEBHOOK_URL must be set in .env to send Slack notifications',
      );
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `*${message.subject}*\n${message.body}` }),
    });

    if (!response.ok) {
      throw new Error(`SlackAdapter: webhook responded with ${response.status}`);
    }
  }
}

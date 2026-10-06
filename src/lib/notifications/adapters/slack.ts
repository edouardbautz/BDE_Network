import { neutralizeForSlack } from '../sanitize';
import { fitSlackPayload } from '../slack-blocks';
import type { NotificationAdapter, NotificationMessage } from '../types';

/** What is posted to the webhook for this message: the card (blocks under a colour bar) when the
 * notification has one, the plain subject and body otherwise. The summary for notifications goes in the
 * attachment's `fallback` and the message has no `text` of its own: with a `text`, Slack shows it in
 * the channel above the card, and the card then says everything twice. Every
 * text is made harmless and cut to Slack's limits first, so nothing a member typed can ping a
 * channel, and a long title can never get the message refused. */
function payloadOf(message: NotificationMessage): Record<string, unknown> {
  if (message.slack) {
    const { fallback, color, blocks } = fitSlackPayload(message.slack);
    if (blocks.length > 0) {
      return { attachments: [{ color, fallback, blocks }] };
    }
  }

  return {
    text: `*${neutralizeForSlack(message.subject)}*\n${neutralizeForSlack(message.body)}`,
  };
}

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
      body: JSON.stringify(payloadOf(message)),
    });

    if (!response.ok) {
      throw new Error(`SlackAdapter: webhook responded with ${response.status}`);
    }
  }
}

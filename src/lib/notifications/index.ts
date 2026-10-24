import type { NotificationChannel } from '@/config/schema';
import { DiscordAdapter } from './adapters/discord';
import { EmailAdapter } from './adapters/email';
import { SlackAdapter } from './adapters/slack';
import type { NotificationAdapter, NotificationMessage, SendOutcome } from './types';

/** `webhookUrl`: a webhook other than the one of the settings (the staff's room); the e-mail has none. */
function getAdapter(channel: NotificationChannel, webhookUrl?: string): NotificationAdapter {
  switch (channel) {
    case 'email':
      return new EmailAdapter();
    case 'discord':
      return new DiscordAdapter(webhookUrl);
    case 'slack':
      return new SlackAdapter(webhookUrl);
  }
}

/**
 * Sends a notification through one channel. Callers are the members notifications (lib/members/notifications.ts) and the
 * events ones (lib/events/notifications.ts), always through `deliver()` (./deliver.ts), which asks it once for each channel
 * the event is set to and turns a failure into a log line: a notification must never break the action that triggered it,
 * and the failure of a channel never stops the others. This function itself throws if the adapter fails.
 */
export async function notify(
  channel: NotificationChannel,
  message: NotificationMessage,
  options: { webhookUrl?: string } = {},
): Promise<void> {
  await getAdapter(channel, options.webhookUrl).send(message);
}

/**
 * Sends the same notification as several messages (one per email recipient) through one channel. An adapter that can share
 * a connection does (see `sendMany`); the others send one after the other. One outcome per message; never throws for a
 * single failure.
 */
export async function notifyMany(
  channel: NotificationChannel,
  messages: NotificationMessage[],
): Promise<SendOutcome[]> {
  const adapter = getAdapter(channel);
  if (adapter.sendMany) {
    return adapter.sendMany(messages);
  }

  const outcomes: SendOutcome[] = [];
  for (const message of messages) {
    try {
      await adapter.send(message);
      outcomes.push({ ok: true });
    } catch (error) {
      outcomes.push({ ok: false, error });
    }
  }
  return outcomes;
}

export type { NotificationAdapter, NotificationMessage, SendOutcome } from './types';

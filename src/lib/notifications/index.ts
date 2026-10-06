import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import { DiscordAdapter } from './adapters/discord';
import { EmailAdapter } from './adapters/email';
import { NoneAdapter } from './adapters/none';
import { SlackAdapter } from './adapters/slack';
import type { NotificationAdapter, NotificationMessage, SendOutcome } from './types';

function getAdapter(channel: string): NotificationAdapter {
  switch (channel) {
    case 'email':
      return new EmailAdapter();
    case 'discord':
      return new DiscordAdapter();
    case 'slack':
      return new SlackAdapter();
    default:
      return new NoneAdapter();
  }
}

/**
 * Sends a notification through the channel configured for this event in bde.config.yml.
 * Callers are the members notifications (lib/members/notifications.ts) and the events ones
 * (lib/events/notifications.ts), always through `deliver()` (./deliver.ts), which turns a failure
 * into a log line: a notification must never break the action that triggered it. This function
 * itself throws if the adapter fails.
 */
export async function notify(
  event: NotificationEvent,
  message: NotificationMessage,
): Promise<void> {
  const channel = getConfig().notifications[event];
  await getAdapter(channel).send(message);
}

/**
 * Sends the same event's notification as several messages (one per email recipient). An adapter
 * that can share a connection does (see `sendMany`); the others send one after the other. One
 * outcome per message; never throws for a single failure.
 */
export async function notifyMany(
  event: NotificationEvent,
  messages: NotificationMessage[],
): Promise<SendOutcome[]> {
  const adapter = getAdapter(getConfig().notifications[event]);
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

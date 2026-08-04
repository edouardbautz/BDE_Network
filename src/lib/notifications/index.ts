import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import { DiscordAdapter } from './adapters/discord';
import { EmailAdapter } from './adapters/email';
import { NoneAdapter } from './adapters/none';
import { SlackAdapter } from './adapters/slack';
import type { NotificationAdapter, NotificationMessage } from './types';

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

/** Sends a notification through the channel configured for this event in
 * bde.config.yml. Not called from any use case yet — future modules
 * (member approval, events, finances...) will call this directly. */
export async function notify(
  event: NotificationEvent,
  message: NotificationMessage,
): Promise<void> {
  const channel = getConfig().notifications[event];
  await getAdapter(channel).send(message);
}

export type { NotificationAdapter, NotificationMessage } from './types';

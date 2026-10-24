import type { NotificationChannel } from '@/config/schema';
import { setting } from '@/lib/settings/runtime';

/**
 * Where a message goes in a chat: the BDE's room (the webhook of the settings, which is what every message used until now), or the
 * school's staff's own, when the owners gave it one. The staff is not necessarily on the BDE's Discord or Slack, so what is written to it
 * goes to its own webhook when there is one, and to the BDE's room (with the mentions) when there is not.
 */
export type Room = 'bde' | 'staff';

/** The webhook of a room for a channel, or undefined for the one of the BDE's settings (the adapter reads it). */
export function webhookOf(channel: NotificationChannel, room: Room): string | undefined {
  if (room !== 'staff') return undefined;
  if (channel === 'discord') return setting('DISCORD_STAFF_WEBHOOK_URL') || undefined;
  if (channel === 'slack') return setting('SLACK_STAFF_WEBHOOK_URL') || undefined;
  return undefined;
}

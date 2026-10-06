import type { NotificationChannel } from '@/config/schema';

/**
 * What the "Confirm this event" dialog says about notifying the members, so nobody confirms
 * thinking nothing will be sent (or the opposite):
 * - the members are told only once per event (`confirmationNotifiedAt`), so a second confirmation
 *   after going back to draft sends nothing;
 * - otherwise it depends on the channel the BDE chose for `eventConfirmed`.
 * `null` when nothing will be sent and there is nothing to say.
 */
export type ConfirmationNotice = 'notifyEmail' | 'notifyChat' | 'alreadyNotified';

export function confirmationNotice(
  channel: NotificationChannel,
  alreadyNotified: boolean,
): ConfirmationNotice | null {
  if (channel === 'none') return null;
  if (alreadyNotified) return 'alreadyNotified';
  return channel === 'email' ? 'notifyEmail' : 'notifyChat';
}

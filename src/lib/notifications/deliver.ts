import { getConfig } from '@/config';
import { channelsFor, type NotificationChannel, type NotificationEvent } from '@/config/schema';
import { notify, notifyMany } from './index';
import type { NotificationMessage } from './types';

export interface DeliveryResult {
  sent: number;
  failed: number;
  /** What happened on each channel the event is set to (a channel the event is not set to is not there). */
  channels: Partial<Record<NotificationChannel, { sent: number; failed: number }>>;
}

/**
 * Sends one message through EVERY channel configured for `event` (none, one or several). The channels are independent: they
 * go out at the same time, each in its own try/catch, so a Discord webhook that is down never holds back the e-mails or the
 * Slack message, nor cancels what already left. Webhook channels (Discord/Slack) get a single post; email gets one message
 * per recipient, each isolated too, so one bad address or a transient SMTP error never prevents the others from being
 * notified. An event with no channel sends nothing. Never throws: a notification problem must not break the action that
 * triggered it. `logPrefix` says whose notification failed (e.g. "[events]").
 */
export async function deliver(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  emailRecipients: readonly string[],
  logPrefix: string,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0, channels: {} };

  let channels: NotificationChannel[];
  try {
    channels = channelsFor(getConfig(), event);
  } catch (error) {
    // Config problem — still must not propagate.
    console.error(`${logPrefix} ${event}: notification aborted`, error);
    return result;
  }

  await Promise.all(
    channels.map(async (channel) => {
      const own = { sent: 0, failed: 0 };
      result.channels[channel] = own;
      try {
        if (channel === 'email') {
          // One connection for all the recipients; a refused address does not stop the others.
          const outcomes = await notifyMany(
            channel,
            emailRecipients.map((to) => ({ ...message, to })),
          );
          for (const outcome of outcomes) {
            if (outcome.ok) {
              own.sent += 1;
            } else {
              own.failed += 1;
              console.error(`${logPrefix} ${event}: email to a recipient failed`, outcome.error);
            }
          }
        } else {
          await notify(channel, message);
          own.sent += 1;
        }
      } catch (error) {
        own.failed += 1;
        console.error(`${logPrefix} ${event}: ${channel} notification failed`, error);
      }
    }),
  );

  for (const own of Object.values(result.channels)) {
    result.sent += own.sent;
    result.failed += own.failed;
  }
  return result;
}

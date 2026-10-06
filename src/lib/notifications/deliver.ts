import { getConfig } from '@/config';
import type { NotificationEvent } from '@/config/schema';
import { notify, notifyMany } from './index';
import type { NotificationMessage } from './types';

export interface DeliveryResult {
  sent: number;
  failed: number;
}

/**
 * Sends one message through the channel configured for `event`. Webhook channels
 * (Discord/Slack) get a single post; email gets one message per recipient, each in its own
 * try/catch so one bad address or a transient SMTP error never prevents the others from
 * being notified. Never throws: a notification problem must not break the action that
 * triggered it. `logPrefix` says whose notification failed (e.g. "[events]").
 */
export async function deliver(
  event: NotificationEvent,
  message: Omit<NotificationMessage, 'to'>,
  emailRecipients: readonly string[],
  logPrefix: string,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0 };

  try {
    const channel = getConfig().notifications[event];
    if (channel === 'none') {
      return result;
    }

    if (channel !== 'email') {
      try {
        await notify(event, message);
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error(`${logPrefix} ${event}: ${channel} notification failed`, error);
      }
      return result;
    }

    // One connection for all the recipients; a refused address does not stop the others.
    const outcomes = await notifyMany(
      event,
      emailRecipients.map((to) => ({ ...message, to })),
    );
    for (const outcome of outcomes) {
      if (outcome.ok) {
        result.sent += 1;
      } else {
        result.failed += 1;
        console.error(`${logPrefix} ${event}: email to a recipient failed`, outcome.error);
      }
    }
  } catch (error) {
    // Config or adapter selection problem — still must not propagate.
    console.error(`${logPrefix} ${event}: notification aborted`, error);
  }

  return result;
}

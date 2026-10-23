import type { NotificationChannel } from '@/config/schema';

/**
 * What the "Confirm this event" dialog says about notifying the members, so nobody confirms
 * thinking nothing will be sent (or the opposite):
 * - the members are told only once per event (`confirmationNotifiedAt`), so a second confirmation
 *   after going back to draft sends nothing;
 * - otherwise it depends on the channels the BDE chose for `eventConfirmed`: e-mail, one or two chat
 *   channels (Discord, Slack), or an e-mail and the chat at once.
 * `null` when nothing will be sent and there is nothing to say.
 */
export type ConfirmationNoticeKey = 'notifyEmail' | 'notifyChat' | 'notifyBoth' | 'alreadyNotified';

export interface ConfirmationNotice {
  key: ConfirmationNoticeKey;
  /** The chat channels the message will be posted on, in the order of the configuration: "Discord and Slack". */
  chat: string[];
}

const CHANNEL_NAME: Record<NotificationChannel, string> = {
  discord: 'Discord',
  slack: 'Slack',
  email: 'e-mail',
};

export function confirmationNotice(
  channels: readonly NotificationChannel[],
  alreadyNotified: boolean,
): ConfirmationNotice | null {
  if (channels.length === 0) return null;
  if (alreadyNotified) return { key: 'alreadyNotified', chat: [] };
  const chat = channels.filter((channel) => channel !== 'email').map((c) => CHANNEL_NAME[c]);
  const email = channels.includes('email');
  const key = email ? (chat.length > 0 ? 'notifyBoth' : 'notifyEmail') : 'notifyChat';
  return { key, chat };
}

/** The names of the chat channels as a sentence part ("Discord", "Discord and Slack"), in the language of the page. */
export function chatNames(notice: ConfirmationNotice, locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(notice.chat);
}

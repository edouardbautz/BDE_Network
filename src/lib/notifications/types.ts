import type { DiscordPayload } from './discord-embed';
import type { SlackPayload } from './slack-blocks';

/** An e-mail: the HTML, the same content as text for the clients that do not show HTML, and the
 * calendar file some e-mails carry. */
export interface EmailContent {
  html: string;
  text: string;
  /** An iCalendar file: mail clients then offer "add to calendar". */
  ics?: { content: string; filename: string };
}

export interface NotificationMessage {
  subject: string;
  body: string;
  /** Recipient email address. Required by the email adapter, ignored by
   * webhook-based adapters (Discord/Slack post to a fixed channel). */
  to?: string;
  /** The same notification as Discord cards. Only the Discord adapter reads it: email and Slack use
   * `subject` and `body`, and Discord falls back to them when this is absent. */
  discord?: DiscordPayload;
  /** The same notification as a designed e-mail. Only the e-mail adapter reads it; without it, it
   * sends `body` as plain text. */
  email?: EmailContent;
  /** The same notification as a Slack message (blocks and a colour bar). Only the Slack adapter reads it. */
  slack?: SlackPayload;
}

/** What happened to one message of a batch. */
export type SendOutcome = { ok: true } | { ok: false; error: unknown };

export interface NotificationAdapter {
  send(message: NotificationMessage): Promise<void>;
  /**
   * Several messages in one go, for an adapter that gains from sharing one connection (email: one
   * SMTP connection for the whole batch instead of one per recipient). One outcome per message, in
   * order; a message that fails never prevents the next ones, and nothing is thrown.
   */
  sendMany?(messages: NotificationMessage[]): Promise<SendOutcome[]>;
}

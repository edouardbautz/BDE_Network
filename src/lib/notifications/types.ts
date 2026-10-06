export interface NotificationMessage {
  subject: string;
  body: string;
  /** Recipient email address. Required by the email adapter, ignored by
   * webhook-based adapters (Discord/Slack post to a fixed channel). */
  to?: string;
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

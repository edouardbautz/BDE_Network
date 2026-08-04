export interface NotificationMessage {
  subject: string;
  body: string;
  /** Recipient email address. Required by the email adapter, ignored by
   * webhook-based adapters (Discord/Slack post to a fixed channel). */
  to?: string;
}

export interface NotificationAdapter {
  send(message: NotificationMessage): Promise<void>;
}

/**
 * How long the platform waits for the other side of a notification. A notification is best effort and sent after the response, so
 * nobody waits for it, but a channel that accepts the connection and never answers would hold a socket and a task for as long
 * as the library allows (five minutes for `fetch`, ten for the mail library), and the reminder loop sends its messages one
 * after the other. Found by the resilience suite of the quality campaign (`qa/resilience`, a webhook that never answers).
 */

/** A webhook (Discord, Slack) must answer within this, the whole request included. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** The mail server: to accept the connection, to greet, and to say something while a message is on its way. */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

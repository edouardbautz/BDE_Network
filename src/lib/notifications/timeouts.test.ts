import { describe, expect, it } from 'vitest';
import { SMTP_TIMEOUTS, WEBHOOK_TIMEOUT_MS } from './timeouts';

/** The limits themselves: they exist and they are small (the behaviour is `adapters/deaf-channel.test.ts`). */
describe('the timeouts of the notification channels', () => {
  it('give a webhook seconds, not minutes', () => {
    expect(WEBHOOK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(WEBHOOK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('give a mail server seconds to accept and greet, and under a minute of silence', () => {
    expect(SMTP_TIMEOUTS.connectionTimeout).toBeLessThanOrEqual(30_000);
    expect(SMTP_TIMEOUTS.greetingTimeout).toBeLessThanOrEqual(30_000);
    expect(SMTP_TIMEOUTS.socketTimeout).toBeGreaterThan(0);
    expect(SMTP_TIMEOUTS.socketTimeout).toBeLessThanOrEqual(60_000);
  });
});

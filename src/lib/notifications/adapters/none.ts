import type { NotificationAdapter, NotificationMessage } from '../types';

/** Used when a BDE hasn't configured a channel for an event type. */
export class NoneAdapter implements NotificationAdapter {
  async send(_message: NotificationMessage): Promise<void> {
    // Intentionally a no-op.
  }
}

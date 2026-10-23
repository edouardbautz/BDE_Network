import type { NotificationChannel } from '@/config/schema';

type Value = string | readonly string[];

/**
 * The `notifications` section of a configuration built by hand in a test (a mocked `getConfig`, which bypasses the schema): each
 * type of notification as the list of channels the real configuration holds. `'none'` is no channel, a name is that channel.
 */
export function notificationsConfig(
  values: Record<string, Value>,
): Record<string, NotificationChannel[]> {
  return Object.fromEntries(
    Object.entries(values).map(([event, value]) => [
      event,
      (value === 'none'
        ? []
        : typeof value === 'string'
          ? [value]
          : [...value]) as NotificationChannel[],
    ]),
  );
}

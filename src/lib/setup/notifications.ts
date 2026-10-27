import '../zod-config';
import { z } from 'zod';
import {
  BACKUP_NOTIFICATION_EVENTS,
  INTRA_NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from '@/config/schema';
import type { SmtpSettings } from './notify-test';
import {
  validateDiscordWebhook,
  validateEmail,
  validateOptionalText,
  validatePort,
  validateSecretText,
  validateSlackWebhook,
  validateSmtpHost,
  type SetupErrorCode,
} from './validate';

export type Channel = NotificationChannel;

/** What each type of notification is sent through: none, one or several channels. */
export type NotificationMatrix = Record<NotificationEvent, NotificationChannel[]>;

/** A matrix with nothing ticked: no notification at all. */
export const emptyMatrix = (): NotificationMatrix =>
  Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [event, []]),
  ) as unknown as NotificationMatrix;

/** The notification channels and what they need, and what is sent through which, as the installer and the settings page
 * collect it. A channel is configured when its credentials are here. */
export interface NotificationSettings {
  matrix: NotificationMatrix;
  discordWebhook?: string;
  slackWebhook?: string;
  smtp?: SmtpSettings;
}

const text = z.string().max(500);

const channelList = z.array(z.enum(NOTIFICATION_CHANNELS)).max(NOTIFICATION_CHANNELS.length);

const notificationsSchema = z.object({
  /**
   * One list of channels per type of notification, all the types written. The ones about the intra and about the backups may be left
   * out (a page drawn before they existed does not know them): what is saved for them is then kept.
   */
  matrix: z.object(
    Object.fromEntries(
      NOTIFICATION_EVENTS.map((event) => [
        event,
        (INTRA_NOTIFICATION_EVENTS as readonly string[]).includes(event) ||
        (BACKUP_NOTIFICATION_EVENTS as readonly string[]).includes(event)
          ? channelList.optional()
          : channelList,
      ]),
    ) as Record<NotificationEvent, typeof channelList>,
  ),
  /** Blank: keep the one saved before (unless the channel is removed). */
  discordWebhook: text.optional(),
  slackWebhook: text.optional(),
  smtp: z.object({ host: text, port: text, user: text, password: text, from: text }).optional(),
  /** Channels whose credentials are forgotten: their column is cleared. */
  removed: z.array(z.enum(NOTIFICATION_CHANNELS)).optional(),
});

export type ParsedNotifications =
  | { ok: true; value: NotificationSettings }
  | { ok: false; code: SetupErrorCode | 'invalid'; field?: string };

const failure = (
  code: SetupErrorCode | 'invalid',
  field?: string,
): { ok: false; code: SetupErrorCode | 'invalid'; field?: string } => ({
  ok: false,
  code,
  ...(field && { field }),
});

type Parsed = z.infer<typeof notificationsSchema>;
type Credentials = Pick<NotificationSettings, 'discordWebhook' | 'slackWebhook' | 'smtp'>;
type CredentialResult =
  { ok: true; value: Credentials } | { ok: false; code: SetupErrorCode; field: string };

/** The webhook typed, or the one saved before when the field is left blank. */
function webhook(
  typed: string | undefined,
  saved: string | undefined,
  validate: typeof validateDiscordWebhook,
  field: string,
  keep: boolean,
): { ok: true; value: string | undefined } | { ok: false; code: SetupErrorCode; field: string } {
  const value = (typed ?? '').trim();
  if (value === '') return { ok: true, value: keep ? saved : undefined };
  const checked = validate(value);
  return checked.ok
    ? { ok: true, value: checked.value }
    : { ok: false, code: checked.error, field };
}

/**
 * The credentials of ONE channel, from what was typed and what is saved. Left blank, a channel keeps what was saved (and
 * the page never gets a secret back); `removed` forgets it. For the mail server, typing any of its host or sender means
 * the whole form is meant, and every part is checked.
 */
function credentialsOf(
  channel: NotificationChannel,
  input: Parsed,
  before: NotificationSettings | undefined,
): CredentialResult {
  const keep = !input.removed?.includes(channel);

  if (channel === 'discord') {
    const url = webhook(
      input.discordWebhook,
      before?.discordWebhook,
      validateDiscordWebhook,
      'discordWebhook',
      keep,
    );
    if (!url.ok) return url;
    return { ok: true, value: url.value ? { discordWebhook: url.value } : {} };
  }

  if (channel === 'slack') {
    const url = webhook(
      input.slackWebhook,
      before?.slackWebhook,
      validateSlackWebhook,
      'slackWebhook',
      keep,
    );
    if (!url.ok) return url;
    return { ok: true, value: url.value ? { slackWebhook: url.value } : {} };
  }

  const smtp = input.smtp;
  const typed = smtp && (smtp.host.trim() !== '' || smtp.from.trim() !== '');
  if (!smtp || !typed) {
    return { ok: true, value: keep && before?.smtp ? { smtp: before.smtp } : {} };
  }
  const host = validateSmtpHost(smtp.host);
  if (!host.ok) return { ok: false, code: host.error, field: 'smtpHost' };
  const port = validatePort(smtp.port);
  if (!port.ok) return { ok: false, code: port.error, field: 'smtpPort' };
  const user = validateOptionalText(smtp.user);
  if (!user.ok) return { ok: false, code: user.error, field: 'smtpUser' };
  const from = validateEmail(smtp.from);
  if (!from.ok) return { ok: false, code: from.error, field: 'smtpFrom' };
  const password =
    smtp.password === '' && before?.smtp?.password
      ? { ok: true as const, value: before.smtp.password }
      : validateSecretText(smtp.password);
  if (!password.ok) return { ok: false, code: password.error, field: 'smtpPassword' };
  return {
    ok: true,
    value: {
      smtp: {
        host: host.value,
        port: port.value,
        user: user.value,
        password: password.value,
        from: from.value,
      },
    },
  };
}

/** What a channel needs to send, saved or typed. */
export const isConfigured = (settings: Credentials, channel: NotificationChannel): boolean =>
  channel === 'discord'
    ? Boolean(settings.discordWebhook)
    : channel === 'slack'
      ? Boolean(settings.slackWebhook)
      : Boolean(settings.smtp);

/**
 * What the browser sent for the notifications, validated: the webhooks and the SMTP password may be left blank to keep the
 * ones saved before (the page never gets them back). **A box can only be ticked for a channel that is configured**, and the
 * e-mail of `memberRemoved` never exists (the person removed is not written to): both are refused here, whatever the page
 * showed. One place for the installer and the settings page.
 */
export function parseNotifications(
  input: unknown,
  before?: NotificationSettings,
): ParsedNotifications {
  const parsed = notificationsSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');

  const credentials: Credentials = {};
  for (const channel of NOTIFICATION_CHANNELS) {
    const result = credentialsOf(channel, parsed.data, before);
    if (!result.ok) return failure(result.code, result.field);
    Object.assign(credentials, result.value);
  }

  const matrix = emptyMatrix();
  for (const event of NOTIFICATION_EVENTS) {
    const ticked = parsed.data.matrix[event] ?? before?.matrix[event] ?? [];
    if (event === 'memberRemoved' && ticked.includes('email')) {
      return failure('removedNotEmailed', 'matrix');
    }
    for (const channel of ticked) {
      if (!isConfigured(credentials, channel)) return failure('channelNotConfigured', 'matrix');
    }
    matrix[event] = NOTIFICATION_CHANNELS.filter((channel) => ticked.includes(channel));
  }

  return { ok: true, value: { matrix, ...credentials } };
}

export type ParsedCredentials =
  | { ok: true; value: Credentials }
  | { ok: false; code: SetupErrorCode | 'invalid'; field?: string };

/**
 * The credentials of one channel only, for its test message: what is typed (or saved) for the others is not looked at, so
 * a typo in the Slack address does not stop a Discord test.
 */
export function parseChannelForTest(
  input: unknown,
  channel: NotificationChannel,
  before?: NotificationSettings,
): ParsedCredentials {
  const parsed = notificationsSchema
    .pick({ discordWebhook: true, slackWebhook: true, smtp: true, removed: true })
    .safeParse(input);
  if (!parsed.success) return failure('invalid');
  const result = credentialsOf(
    channel,
    { ...parsed.data, matrix: emptyMatrix() } as Parsed,
    before,
  );
  if (!result.ok) return failure(result.code, result.field);
  return isConfigured(result.value, channel) ? result : failure('invalid');
}

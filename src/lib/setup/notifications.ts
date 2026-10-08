import { z } from 'zod';
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

export type Channel = 'none' | 'discord' | 'slack' | 'email';

/** The notification channel and what it needs, as the installer and the settings page collect it. */
export interface NotificationSettings {
  mode: Channel;
  discordWebhook?: string;
  slackWebhook?: string;
  smtp?: SmtpSettings;
}

const text = z.string().max(500);

const notificationsSchema = z.object({
  mode: z.enum(['none', 'discord', 'slack', 'email']),
  /** Blank: keep the one saved before. */
  discordWebhook: text.optional(),
  slackWebhook: text.optional(),
  smtp: z.object({ host: text, port: text, user: text, password: text, from: text }).optional(),
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

/**
 * What the browser sent for the notifications, validated: the webhooks and the SMTP password may be left
 * blank to keep the ones saved before (the page never gets them back). One place for the installer and the
 * settings page.
 */
export function parseNotifications(
  input: unknown,
  before?: NotificationSettings,
): ParsedNotifications {
  const parsed = notificationsSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const { mode } = parsed.data;

  if (mode === 'none') return { ok: true, value: { mode } };

  if (mode === 'discord') {
    const typed = (parsed.data.discordWebhook ?? '').trim();
    const url =
      typed === '' && before?.discordWebhook
        ? { ok: true as const, value: before.discordWebhook }
        : validateDiscordWebhook(typed);
    return url.ok
      ? { ok: true, value: { mode, discordWebhook: url.value } }
      : failure(url.error, 'discordWebhook');
  }

  if (mode === 'slack') {
    const typed = (parsed.data.slackWebhook ?? '').trim();
    const url =
      typed === '' && before?.slackWebhook
        ? { ok: true as const, value: before.slackWebhook }
        : validateSlackWebhook(typed);
    return url.ok
      ? { ok: true, value: { mode, slackWebhook: url.value } }
      : failure(url.error, 'slackWebhook');
  }

  const smtp = parsed.data.smtp;
  if (!smtp) return failure('invalid');
  const host = validateSmtpHost(smtp.host);
  if (!host.ok) return failure(host.error, 'smtpHost');
  const port = validatePort(smtp.port);
  if (!port.ok) return failure(port.error, 'smtpPort');
  const user = validateOptionalText(smtp.user);
  if (!user.ok) return failure(user.error, 'smtpUser');
  const from = validateEmail(smtp.from);
  if (!from.ok) return failure(from.error, 'smtpFrom');
  const password =
    smtp.password === '' && before?.smtp?.password
      ? { ok: true as const, value: before.smtp.password }
      : validateSecretText(smtp.password);
  if (!password.ok) return failure(password.error, 'smtpPassword');

  return {
    ok: true,
    value: {
      mode,
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

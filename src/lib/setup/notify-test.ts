import type { NotificationChannel } from '@/config/schema';
import { DiscordAdapter } from '@/lib/notifications/adapters/discord';
import { EmailAdapter } from '@/lib/notifications/adapters/email';
import { SlackAdapter } from '@/lib/notifications/adapters/slack';
import { buildTestMessage, type TestMessageContext } from '@/lib/notifications/test-message';

/** The mail settings typed in the installer. */
export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** What a channel needs to send, typed or saved. */
export interface ChannelCredentials {
  discordWebhook?: string;
  slackWebhook?: string;
  smtp?: SmtpSettings;
}

export type TestResult = { ok: true } | { ok: false; detail: string };

/** What is said about a failure: a code or a short reason, never the address that was called. */
function describe(error: unknown, secrets: readonly string[] = []): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as Error & { code?: unknown }).code;
  let text = `${typeof code === 'string' ? `${code}: ` : ''}${error.message}`;
  for (const secret of secrets) if (secret) text = text.split(secret).join('***');
  return text.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200);
}

/**
 * Sends the test message of ONE channel, through the very adapter a real notification uses and with what was typed (or saved) for
 * that channel: if it arrives, the channel works, and the card or the e-mail shows how it will look. A failure is a short
 * reason without any address or secret. The other channels are not touched.
 */
export async function sendTestMessage(
  channel: NotificationChannel,
  credentials: ChannelCredentials,
  context: TestMessageContext,
  to?: string,
): Promise<TestResult> {
  const secrets = [
    credentials.discordWebhook,
    credentials.slackWebhook,
    credentials.smtp?.password,
    credentials.smtp?.user,
  ].filter((secret): secret is string => Boolean(secret));
  try {
    const message = await buildTestMessage(channel, context);
    if (channel === 'discord' && credentials.discordWebhook) {
      await new DiscordAdapter(credentials.discordWebhook).send(message);
    } else if (channel === 'slack' && credentials.slackWebhook) {
      await new SlackAdapter(credentials.slackWebhook).send(message);
    } else if (channel === 'email' && credentials.smtp && to) {
      const { host, port, from, user, password } = credentials.smtp;
      await new EmailAdapter({ host, port, from, user, password }).send({ ...message, to });
    } else {
      return { ok: false, detail: 'not configured' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: describe(error, secrets) };
  }
}

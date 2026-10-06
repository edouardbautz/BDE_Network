import { createTransport } from 'nodemailer';
import type { SmtpAnswers } from './answers';
import type { FetchLike } from './fortytwo';

export type TestResult = { ok: true } | { ok: false; detail: string };

/** What is said about a failure: a code or a short reason, never the address that was called. */
function describe(error: unknown, secrets: readonly string[] = []): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as Error & { code?: unknown }).code;
  let text = `${typeof code === 'string' ? `${code}: ` : ''}${error.message}`;
  for (const secret of secrets) if (secret) text = text.split(secret).join('***');
  return text.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200);
}

async function post(fetchFn: FetchLike, url: string, body: unknown): Promise<TestResult> {
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.ok ? { ok: true } : { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: describe(error, [url]) };
  }
}

/** A message in the Discord channel of the webhook. It can ping nobody. */
export function sendDiscordTest(
  fetchFn: FetchLike,
  webhookUrl: string,
  text: string,
): Promise<TestResult> {
  return post(fetchFn, webhookUrl, { content: text, allowed_mentions: { parse: [] } });
}

/** A message in the Slack channel of the webhook. */
export function sendSlackTest(
  fetchFn: FetchLike,
  webhookUrl: string,
  text: string,
): Promise<TestResult> {
  return post(fetchFn, webhookUrl, { text });
}

/** The two things of a mail transport the assistant uses: the tests play it. */
export interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export type TransportFactory = (smtp: SmtpAnswers) => MailTransport;

export const realTransport: TransportFactory = (smtp) =>
  createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

/** Connects to the SMTP server and logs in, without sending anything. */
export async function verifySmtp(
  factory: TransportFactory,
  smtp: SmtpAnswers,
): Promise<TestResult> {
  try {
    await factory(smtp).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: describe(error, [smtp.password, smtp.user]) };
  }
}

export async function sendTestMail(
  factory: TransportFactory,
  smtp: SmtpAnswers,
  to: string,
  subject: string,
  text: string,
): Promise<TestResult> {
  try {
    await factory(smtp).sendMail({ from: smtp.from, to, subject, text });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: describe(error, [smtp.password, smtp.user]) };
  }
}

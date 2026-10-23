import { createTransport, type Transporter } from 'nodemailer';
import type { NotificationAdapter, NotificationMessage, SendOutcome } from '../types';
import { setting } from '@/lib/settings/runtime';
import { SMTP_TIMEOUTS } from '../timeouts';

/** The mail server, as the settings hold it or as the test of a server not saved yet gives it. */
export interface SmtpConnection {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
}

function smtpSettings(given?: SmtpConnection): SmtpConnection {
  if (given) return given;
  const host = setting('SMTP_HOST');
  const port = setting('SMTP_PORT');
  const from = setting('SMTP_FROM');

  if (!host || !port || !from) {
    throw new Error(
      'EmailAdapter: SMTP_HOST, SMTP_PORT and SMTP_FROM must be set in .env to send email notifications',
    );
  }
  return {
    host,
    port: Number(port),
    from,
    user: setting('SMTP_USER') || undefined,
    password: setting('SMTP_PASSWORD') || undefined,
  };
}

export class EmailAdapter implements NotificationAdapter {
  /** `smtp`: the server to use when it is not the one of the settings (the test of a channel not saved yet). */
  constructor(private readonly smtp?: SmtpConnection) {}

  async send(message: NotificationMessage): Promise<void> {
    const [outcome] = await this.sendMany([message]);
    if (outcome && !outcome.ok) {
      throw outcome.error;
    }
  }

  /**
   * One SMTP connection for the whole batch: opening one per recipient is slow and, for a
   * club of a few hundred members, looks like abuse to the mail server. Messages go one after the
   * other over it; one that fails (a refused address) does not stop the others.
   */
  async sendMany(messages: NotificationMessage[]): Promise<SendOutcome[]> {
    let settings: SmtpConnection;
    try {
      settings = smtpSettings(this.smtp);
    } catch (error) {
      return messages.map(() => ({ ok: false, error }));
    }

    let transport: Transporter | undefined;
    const outcomes: SendOutcome[] = [];

    try {
      for (const message of messages) {
        if (!message.to) {
          outcomes.push({ ok: false, error: new Error('EmailAdapter: message.to is required') });
          continue;
        }

        // Created at the first message that can really be sent, so a batch of unusable ones
        // never connects.
        transport ??= createTransport({
          host: settings.host,
          port: settings.port,
          secure: settings.port === 465,
          auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
          pool: true,
          maxConnections: 1,
          ...SMTP_TIMEOUTS,
        });

        try {
          const { email } = message;
          await transport.sendMail({
            from: settings.from,
            to: message.to,
            subject: email?.subject ?? message.subject,
            text: email?.text ?? message.body,
            ...(email && { html: email.html }),
            // Sent as the calendar part of the message, which mail clients turn into an "add to
            // calendar" offer, and as a file for those that do not.
            ...(email?.ics && {
              icalEvent: {
                method: 'PUBLISH',
                filename: email.ics.filename,
                content: email.ics.content,
              },
            }),
          });
          outcomes.push({ ok: true });
        } catch (error) {
          outcomes.push({ ok: false, error });
        }
      }
    } finally {
      transport?.close();
    }

    return outcomes;
  }
}

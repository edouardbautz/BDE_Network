import { createTransport, type Transporter } from 'nodemailer';
import type { NotificationAdapter, NotificationMessage, SendOutcome } from '../types';

function smtpSettings() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !from) {
    throw new Error(
      'EmailAdapter: SMTP_HOST, SMTP_PORT and SMTP_FROM must be set in .env to send email notifications',
    );
  }
  return { host, port: Number(port), from };
}

export class EmailAdapter implements NotificationAdapter {
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
    let settings: ReturnType<typeof smtpSettings>;
    try {
      settings = smtpSettings();
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
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined,
          pool: true,
          maxConnections: 1,
        });

        try {
          await transport.sendMail({
            from: settings.from,
            to: message.to,
            subject: message.subject,
            text: message.body,
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

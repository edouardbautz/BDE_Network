import { createTransport } from 'nodemailer';
import type { NotificationAdapter, NotificationMessage } from '../types';

export class EmailAdapter implements NotificationAdapter {
  async send(message: NotificationMessage): Promise<void> {
    if (!message.to) {
      throw new Error('EmailAdapter: message.to is required');
    }

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const from = process.env.SMTP_FROM;

    if (!host || !port || !from) {
      throw new Error(
        'EmailAdapter: SMTP_HOST, SMTP_PORT and SMTP_FROM must be set in .env to send email notifications',
      );
    }

    const transport = createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });

    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  }
}

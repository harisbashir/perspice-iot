import nodemailer from 'nodemailer';
import type { SmtpSettings } from '../../settings/settings.service';
import type { EmailDriver, OutgoingEmail } from './email.driver';

export class SmtpDriver implements EmailDriver {
  private readonly transport;

  constructor(settings: SmtpSettings) {
    this.transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(msg: OutgoingEmail): Promise<void> {
    await this.transport.sendMail(msg);
    this.transport.close();
  }
}

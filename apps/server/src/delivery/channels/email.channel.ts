import { Injectable } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import type { Delivery, NotificationChannel } from '../types';

/** Renders the message's template (branded for its tenant) and sends it now. */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email' as const;

  constructor(private readonly email: EmailService) {}

  async send({ recipient, message: m, url }: Delivery): Promise<void> {
    if (!m.email) throw new Error(`No email template for ${m.type}`);
    const sent = await this.email.deliver({
      templateKey: m.email.template,
      to: recipient.email,
      vars: { name: recipient.name, link: url, ...m.email.vars },
      customerId: m.customerId,
    });
    if (!sent) throw new Error('Email is not configured');
  }
}

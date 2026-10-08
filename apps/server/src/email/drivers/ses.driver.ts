import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SesSettings } from '../../settings/settings.service';
import type { EmailDriver, OutgoingEmail } from './email.driver';

export class SesDriver implements EmailDriver {
  private readonly client: SESv2Client;

  constructor(settings: SesSettings) {
    this.client = new SESv2Client({
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async send(msg: OutgoingEmail): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: msg.from,
        Destination: { ToAddresses: [msg.to] },
        Content: {
          Simple: {
            Subject: { Data: msg.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: msg.html, Charset: 'UTF-8' }, Text: { Data: msg.text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}

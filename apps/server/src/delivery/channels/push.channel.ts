import { Injectable } from '@nestjs/common';
import { PushService } from '../push.service';
import type { Delivery, NotificationChannel } from '../types';

@Injectable()
export class PushChannel implements NotificationChannel {
  readonly name = 'push' as const;

  constructor(private readonly push: PushService) {}

  async send({ recipient, message: m, url }: Delivery): Promise<void> {
    await this.push.send(recipient.id, { title: m.title, body: m.body, url, severity: m.level, tag: m.type });
  }
}

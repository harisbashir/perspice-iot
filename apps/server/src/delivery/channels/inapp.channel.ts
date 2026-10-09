import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import type { Delivery, NotificationChannel } from '../types';

const SEVERITY = { info: 'info', warning: 'warning', minor: 'warning', major: 'critical', critical: 'critical' } as const;

/** Stored in the bell list and pushed to open sessions. */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = 'inapp' as const;

  constructor(private readonly notifications: NotificationsService) {}

  async send({ recipient, message: m }: Delivery): Promise<void> {
    await this.notifications.create(recipient.id, {
      type: m.type,
      severity: SEVERITY[m.level],
      title: m.title,
      body: m.body,
      ...(m.link ? { link: m.link } : {}),
    });
  }
}

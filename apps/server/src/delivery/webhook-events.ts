import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AlarmChange, AlarmRow } from '../alarms/alarm-store';
import { AlarmStore } from '../alarms/alarm-store';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { device } from '../db/schema';
import type { DomainEvent } from '../events/events';
import { StreamConsumer } from '../events/stream-consumer';
import { WebhooksService } from './webhooks.service';

/**
 * Feeds webhooks: alarm changes (from whichever process made them) and, in the rules role,
 * device status changes from the event stream.
 */
@Injectable()
export class WebhookEvents implements OnModuleInit, OnApplicationShutdown {
  private consumer?: StreamConsumer;

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: AlarmStore,
    private readonly webhooks: WebhooksService,
    @Inject('CONSUME_STATUS_FOR_WEBHOOKS') private readonly consumeStatus: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    this.store.onChange((change, a) => this.alarm(change, a));
    if (this.consumeStatus) {
      this.consumer = new StreamConsumer(this.redis, { group: 'webhooks', handle: (e) => this.status(e) });
      await this.consumer.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }

  private async deviceName(id: string): Promise<string> {
    return (await this.db.query.device.findFirst({ where: eq(device.id, id), columns: { name: true } }))?.name ?? '';
  }

  async alarm(change: AlarmChange, a: AlarmRow): Promise<void> {
    await this.webhooks.emit(`alarm.${change}`, a.customerId, {
      alarm: {
        id: a.id,
        rule: a.ruleName,
        type: a.type,
        severity: a.severity,
        status: a.status,
        message: a.message,
        value: a.value,
        startedAt: a.startedAt.toISOString(),
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        clearedAt: a.clearedAt?.toISOString() ?? null,
        clearReason: a.clearReason,
      },
      device: { id: a.deviceId, name: await this.deviceName(a.deviceId) },
      customerId: a.customerId,
    });
  }

  async status(e: DomainEvent): Promise<void> {
    if (e.type !== 'device.status_changed') return;
    await this.webhooks.emit('device.status_changed', e.customerId, {
      device: { id: e.deviceId, name: await this.deviceName(e.deviceId) },
      customerId: e.customerId,
      from: e.from,
      to: e.to,
      at: new Date(e.ts).toISOString(),
    });
  }
}

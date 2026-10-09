import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { DeviceStatus } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { device, deviceProfile } from '../db/schema';
import { Dispatcher } from '../delivery/dispatcher';
import { RecipientResolver } from '../delivery/recipients';
import type { EmailTemplateKey } from '../email/templates';
import type { DomainEvent } from '../events/events';
import { StreamConsumer } from '../events/stream-consumer';

const COOLDOWN_S = 300;

interface Rule {
  template: EmailTemplateKey;
  severity: 'info' | 'warning' | 'critical';
  title: (name: string) => string;
}

/** Which transitions notify (spec: online→offline, offline→dead, offline|dead→online). */
export function notificationRule(from: DeviceStatus, to: DeviceStatus): Rule | null {
  if (to === 'offline' && from === 'online') {
    return { template: 'device_offline', severity: 'warning', title: (n) => `Device offline: ${n}` };
  }
  if (to === 'dead' && (from === 'offline' || from === 'online')) {
    return { template: 'device_dead', severity: 'critical', title: (n) => `Device dead: ${n}` };
  }
  if (to === 'online' && (from === 'offline' || from === 'dead')) {
    return { template: 'device_online', severity: 'info', title: (n) => `Device back online: ${n}` };
  }
  return null;
}

/** Runs in the `rules` role: turns device status changes into notifications (through the dispatcher). */
@Injectable()
export class StatusNotifierConsumer implements OnModuleInit, OnApplicationShutdown {
  private consumer?: StreamConsumer;

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dispatcher: Dispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer = new StreamConsumer(this.redis, { group: 'rules', handle: (e) => this.handle(e) });
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.type !== 'device.status_changed') return;
    const rule = notificationRule(event.from, event.to);
    if (!rule) return;

    const [row] = await this.db
      .select({ device, profile: deviceProfile })
      .from(device)
      .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
      .where(eq(device.id, event.deviceId));
    if (!row || !row.profile.statusNotify.enabled) return;

    // Flapping devices: at most one notification per device and target status every 5 minutes.
    const fresh = await this.redis.set(`notify:cool:${event.deviceId}:${event.to}`, '1', 'EX', COOLDOWN_S, 'NX');
    if (!fresh) return;

    const { roleKeys, channels } = row.profile.statusNotify;
    const recipients = await this.recipients.resolve({ roles: roleKeys, userIds: [], groupIds: [] }, { customerId: row.device.customerId, groupId: row.device.groupId });
    const lastSeen = row.device.lastSeen ?? new Date(event.ts);
    await this.dispatcher.dispatch(recipients, {
      type: `device.${event.to}`,
      level: rule.severity,
      title: rule.title(row.device.name),
      body: `${row.device.name} (${row.profile.name}) is ${event.to}.`,
      link: `/devices/${row.device.id}`,
      customerId: row.device.customerId,
      email: {
        template: rule.template,
        vars: {
          deviceName: row.device.name,
          profileName: row.profile.name,
          lastSeen: lastSeen.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        },
      },
    }, channels);
  }
}

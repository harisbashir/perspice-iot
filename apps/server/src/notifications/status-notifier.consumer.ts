import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { BuiltInRoleKey, DeviceStatus } from '@perspice/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AuthService } from '../auth/auth.service';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { customer, device, deviceProfile, role, user } from '../db/schema';
import { EmailService } from '../email/email.service';
import type { EmailTemplateKey } from '../email/templates';
import type { DomainEvent } from '../events/events';
import { StreamConsumer } from '../events/stream-consumer';
import { NotificationsService } from './notifications.service';

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

/** Runs in the `rules` role: turns device status changes into in-app and email notifications. */
@Injectable()
export class StatusNotifierConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StatusNotifierConsumer.name);
  private consumer?: StreamConsumer;

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
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
      .select({ device, profile: deviceProfile, slug: customer.slug })
      .from(device)
      .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
      .leftJoin(customer, eq(customer.id, device.customerId))
      .where(eq(device.id, event.deviceId));
    if (!row || !row.profile.statusNotify.enabled) return;

    // Flapping devices: at most one notification per device and target status every 5 minutes.
    const fresh = await this.redis.set(`notify:cool:${event.deviceId}:${event.to}`, '1', 'EX', COOLDOWN_S, 'NX');
    if (!fresh) return;

    const { roleKeys, channels } = row.profile.statusNotify;
    const recipients = await this.recipients(row.device.customerId, roleKeys);
    const lastSeen = row.device.lastSeen ?? new Date(event.ts);
    const title = rule.title(row.device.name);
    const path = `/devices/${row.device.id}`;

    for (const r of recipients) {
      try {
        if (channels.includes('inapp')) {
          await this.notifications.create(r.id, {
            type: `device.${event.to}`,
            severity: rule.severity,
            title,
            body: `${row.device.name} (${row.profile.name}) is ${event.to}.`,
            link: path,
          });
        }
        if (channels.includes('email')) {
          const base = this.auth.publicUrlFor(r.scopeType === 'customer' ? row.slug : null);
          await this.email.send(
            rule.template,
            r.email,
            {
              deviceName: row.device.name,
              profileName: row.profile.name,
              lastSeen: lastSeen.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
              link: `${base}${path}`,
            },
            { customerId: row.device.customerId },
          );
        }
      } catch (err) {
        this.logger.error(`Notifying ${r.id} about ${event.deviceId} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Active customer users with a listed role, plus platform admins when `platform_admin` is listed. */
  private async recipients(customerId: string | null, roleKeys: BuiltInRoleKey[]) {
    if (!roleKeys.length) return [];
    const platformKeys: BuiltInRoleKey[] = roleKeys.includes('platform_admin') ? ['platform_admin', 'super_admin'] : [];
    const customerKeys = roleKeys.filter((k) => !platformKeys.includes(k));
    const scopes = [
      customerId && customerKeys.length
        ? and(eq(user.customerId, customerId), inArray(role.key, customerKeys))
        : undefined,
      platformKeys.length ? and(eq(user.scopeType, 'platform'), inArray(role.key, platformKeys)) : undefined,
    ].filter(Boolean);
    if (!scopes.length) return [];
    return this.db
      .select({ id: user.id, email: user.email, scopeType: user.scopeType })
      .from(user)
      .innerJoin(role, eq(role.id, user.roleId))
      .where(and(eq(user.status, 'active'), or(...scopes)));
  }
}

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AlarmChange, AlarmRow } from '../alarms/alarm-store';
import { AlarmStore } from '../alarms/alarm-store';
import type { RuleRow } from '../alarms/effective';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { device, deviceProfile } from '../db/schema';
import { Dispatcher } from './dispatcher';
import { RecipientResolver } from './recipients';
import type { Message } from './types';

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const SUPPRESSED_TTL_S = 7 * 86_400;

function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

/**
 * Notifies a rule's recipients when it raises or clears an alarm. A per-(rule, device) cooldown
 * limits repeat notifications for flapping alarms; when a raise was not notified, neither is its
 * clear (Review Focus 1). Acknowledgements and manual clears don't notify.
 */
@Injectable()
export class AlarmNotifier implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: AlarmStore,
    private readonly dispatcher: Dispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  onModuleInit(): void {
    this.store.onChange((change, alarm, rule) => this.handle(change, alarm, rule));
  }

  async handle(change: AlarmChange, a: AlarmRow, rule: RuleRow | null): Promise<void> {
    if (!rule || change === 'acknowledged' || !rule.channels.length) return;
    if (change === 'raised' && rule.cooldownS > 0) {
      const fresh = await this.redis.set(`notify:cool:alarm:${rule.id}:${a.deviceId}`, '1', 'EX', rule.cooldownS, 'NX');
      if (!fresh) {
        await this.redis.set(`notify:suppressed:${a.id}`, '1', 'EX', SUPPRESSED_TTL_S);
        return;
      }
    }
    if (change === 'cleared' && (await this.redis.del(`notify:suppressed:${a.id}`))) return;

    const [d] = await this.db
      .select({ name: device.name, groupId: device.groupId, profileName: deviceProfile.name })
      .from(device)
      .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
      .where(eq(device.id, a.deviceId));
    if (!d) return;
    const raised = change === 'raised';
    const message: Message = {
      type: `alarm.${change}`,
      level: a.severity,
      title: raised ? `${a.severity.toUpperCase()}: ${a.ruleName} on ${d.name}` : `Cleared: ${a.ruleName} on ${d.name}`,
      body: raised ? a.message : `Active for ${duration((a.clearedAt ?? new Date()).getTime() - a.startedAt.getTime())}.`,
      link: `/alarms/${a.id}`,
      customerId: a.customerId,
      email: {
        template: raised ? 'alarm_raised' : 'alarm_cleared',
        vars: {
          severity: a.severity,
          ruleName: a.ruleName,
          deviceName: d.name,
          profileName: d.profileName,
          message: a.message,
          startedAt: utc(a.startedAt),
          clearedAt: a.clearedAt ? utc(a.clearedAt) : '',
          duration: a.clearedAt ? duration(a.clearedAt.getTime() - a.startedAt.getTime()) : '',
        },
      },
    };
    const to = await this.recipients.resolve(rule.recipients, { customerId: a.customerId, groupId: d.groupId });
    await this.dispatcher.dispatch(to, message, rule.channels);
  }
}

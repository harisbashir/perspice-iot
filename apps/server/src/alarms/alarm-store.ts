import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { alarm, alarmEvent } from '../db/schema';
import type { RuleRow, RuleTarget } from './effective';

export type AlarmRow = typeof alarm.$inferSelect;
export type AlarmChange = 'raised' | 'acknowledged' | 'cleared';
export type AlarmListener = (change: AlarmChange, alarm: AlarmRow, rule: RuleRow | null) => Promise<void>;

/** Redis channel for live alarm updates (the API role forwards them to WebSocket rooms). */
export const ALARM_CHANNEL = 'ws:alarm';

/**
 * Writes alarm state changes: the alarm row, its timeline event, a live update, and the
 * registered listeners (notification dispatch). Raising relies on the partial unique index, so
 * concurrent raises for one (rule, device) produce one alarm (Review Focus 1).
 */
@Injectable()
export class AlarmStore {
  private readonly logger = new Logger(AlarmStore.name);
  private readonly listeners = new Set<AlarmListener>();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onChange(listener: AlarmListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Opens an alarm; returns null when one is already open for the rule and device. */
  async raise(rule: RuleRow, d: RuleTarget, value: { key: string; v: unknown } | undefined, message: string, ts: number): Promise<AlarmRow | null> {
    const [row] = await this.db
      .insert(alarm)
      .values({
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        deviceId: d.id,
        customerId: d.customerId,
        severity: rule.severity,
        startedAt: new Date(ts),
        value: value ?? null,
        message,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await this.db.insert(alarmEvent).values({ alarmId: row.id, type: 'raised', data: { value: value ?? null, message }, ts: new Date(ts) });
    await this.announce('raised', row, rule);
    return row;
  }

  /** Clears the open alarm of a rule on a device (when its clear condition holds). */
  async clearOpen(rule: RuleRow, deviceId: string, value: { key: string; v: unknown } | undefined, ts: number): Promise<AlarmRow | null> {
    const now = new Date(ts);
    const [row] = await this.db
      .update(alarm)
      .set({ status: 'cleared', clearedAt: now, clearReason: 'condition', updatedAt: new Date() })
      .where(and(eq(alarm.ruleId, rule.id), eq(alarm.deviceId, deviceId), sql`${alarm.status} <> 'cleared'`))
      .returning();
    if (!row) return null;
    await this.db.insert(alarmEvent).values({ alarmId: row.id, type: 'cleared', data: { reason: 'condition', value: value ?? null }, ts: now });
    await this.announce('cleared', row, rule);
    return row;
  }

  async announce(change: AlarmChange, row: AlarmRow, rule: RuleRow | null): Promise<void> {
    await this.redis.publish(ALARM_CHANNEL, JSON.stringify({ change, id: row.id, deviceId: row.deviceId, customerId: row.customerId, status: row.status, severity: row.severity }));
    for (const l of this.listeners) {
      try {
        await l(change, row, rule);
      } catch (err) {
        this.logger.error(`Alarm listener failed for ${row.id}: ${(err as Error).message}`);
      }
    }
  }
}

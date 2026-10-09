import type { AlarmRuleInput, AlarmSchedule, AlarmSeverity, NotifyChannel, Recipients } from '@perspice/shared';
import { sql } from 'drizzle-orm';
import { type AnyPgColumn, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer } from './customers';
import { device, deviceProfile } from './devices';
import { user } from './users';

/**
 * An alarm rule. Exactly one scope: a profile (every device of it, all customers), one device,
 * or one customer (optionally narrowed to a profile). `disables_rule_id` turns a device or
 * customer row into an opt-out of an inherited rule.
 */
export const alarmRule = pgTable(
  'alarm_rule',
  {
    id: id(),
    name: text('name').notNull(),
    scopeKind: text('scope_kind', { enum: ['profile', 'device', 'customer'] }).notNull(),
    profileId: uuid('profile_id').references(() => deviceProfile.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => device.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    disablesRuleId: uuid('disables_rule_id').references((): AnyPgColumn => alarmRule.id, { onDelete: 'cascade' }),
    type: text('type').$type<AlarmRuleInput['type']>().notNull(),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    clear: jsonb('clear').$type<Record<string, unknown>>().notNull().default({}),
    severity: text('severity').$type<AlarmSeverity>().notNull(),
    schedule: jsonb('schedule').$type<AlarmSchedule | null>(),
    cooldownS: integer('cooldown_s').notNull().default(300),
    recipients: jsonb('recipients').$type<Recipients>().notNull(),
    channels: text('channels').array().$type<NotifyChannel[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('alarm_rule_profile_idx').on(t.profileId),
    index('alarm_rule_device_idx').on(t.deviceId),
    index('alarm_rule_customer_idx').on(t.customerId),
  ],
);

export const alarm = pgTable(
  'alarm',
  {
    id: id(),
    ruleId: uuid('rule_id').references(() => alarmRule.id, { onDelete: 'set null' }),
    /** Kept so the alarm stays readable after its rule is deleted. */
    ruleName: text('rule_name').notNull(),
    type: text('type').$type<AlarmRuleInput['type']>().notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    severity: text('severity').$type<AlarmSeverity>().notNull(),
    status: text('status', { enum: ['active', 'acknowledged', 'cleared'] })
      .notNull()
      .default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => user.id, { onDelete: 'set null' }),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearReason: text('clear_reason', { enum: ['condition', 'manual', 'rule_removed'] }),
    value: jsonb('value').$type<{ key: string; v: unknown } | null>(),
    message: text('message').notNull().default(''),
    ...timestamps(),
  },
  (t) => [
    // At most one open alarm per (rule, device): concurrent raises collapse into one.
    uniqueIndex('alarm_open_rule_device_uq').on(t.ruleId, t.deviceId).where(sql`status <> 'cleared'`),
    index('alarm_customer_started_idx').on(t.customerId, t.startedAt),
    index('alarm_device_started_idx').on(t.deviceId, t.startedAt),
    index('alarm_status_idx').on(t.status),
  ],
);

export const alarmEvent = pgTable(
  'alarm_event',
  {
    id: id(),
    alarmId: uuid('alarm_id')
      .notNull()
      .references(() => alarm.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['raised', 'acknowledged', 'cleared', 'comment', 'notified'] }).notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    comment: text('comment'),
    data: jsonb('data').$type<Record<string, unknown> | null>(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('alarm_event_alarm_idx').on(t.alarmId, t.ts)],
);

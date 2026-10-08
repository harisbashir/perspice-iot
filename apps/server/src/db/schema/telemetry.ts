import { doublePrecision, jsonb, pgTable, primaryKey, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { device } from './devices';

/** TimescaleDB hypertable (see migration 0001_timescale). No FK: device deletes clean up asynchronously. */
export const telemetry = pgTable(
  'telemetry',
  {
    deviceId: uuid('device_id').notNull(),
    key: text('key').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    valueNum: doublePrecision('value_num'),
    valueStr: text('value_str'),
    valueBool: boolean('value_bool'),
    valueJson: jsonb('value_json'),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.key, t.ts] })],
);

export const telemetryLatest = pgTable(
  'telemetry_latest',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    valueNum: doublePrecision('value_num'),
    valueStr: text('value_str'),
    valueBool: boolean('value_bool'),
    valueJson: jsonb('value_json'),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.key] })],
);

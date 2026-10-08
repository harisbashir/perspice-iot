import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CommandDef, DeviceStatus, StatusNotifyConfig, TelemetryKeyDef } from '@perspice/shared';
import { id, timestamps } from './_common';
import { customer, customerGroup } from './customers';
import { user } from './users';

export const deviceProfile = pgTable('device_profile', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  telemetrySchema: jsonb('telemetry_schema').$type<TelemetryKeyDef[]>().notNull().default([]),
  commands: jsonb('commands').$type<CommandDef[]>().notNull().default([]),
  offlineTimeoutS: integer('offline_timeout_s').notNull().default(300),
  deadTimeoutS: integer('dead_timeout_s').notNull().default(86400),
  sleepy: boolean('sleepy').notNull().default(false),
  transport: text('transport', { enum: ['mqtt', 'http'] })
    .notNull()
    .default('mqtt'),
  locationMode: text('location_mode', { enum: ['none', 'fixed', 'reported'] })
    .notNull()
    .default('none'),
  retentionDays: integer('retention_days').notNull().default(365),
  statusNotify: jsonb('status_notify')
    .$type<StatusNotifyConfig>()
    .notNull()
    .default({ enabled: false, roleKeys: [], channels: [] }),
  ...timestamps(),
});

export interface DeviceAttributes {
  client: Record<string, unknown>;
  server: Record<string, unknown>;
  shared: Record<string, unknown>;
}

export const device = pgTable(
  'device',
  {
    id: id(),
    name: text('name').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => deviceProfile.id),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerGroup.id, { onDelete: 'set null' }),
    credentialsType: text('credentials_type', { enum: ['token'] })
      .notNull()
      .default('token'),
    /** SHA-256 hex of the device token. */
    credentialsHash: text('credentials_hash').notNull().unique(),
    attributes: jsonb('attributes')
      .$type<DeviceAttributes>()
      .notNull()
      .default({ client: {}, server: {}, shared: {} }),
    location: jsonb('location').$type<{
      lat: number;
      lng: number;
      alt?: number;
      source: string;
      updatedAt: number;
    } | null>(),
    tags: text('tags').array().notNull().default([]),
    status: text('status').$type<DeviceStatus>().notNull().default('never'),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    firmwareVersion: text('firmware_version'),
    offlineTimeoutS: integer('offline_timeout_s'),
    deadTimeoutS: integer('dead_timeout_s'),
    disabled: boolean('disabled').notNull().default(false),
    mqttSessionConnectedAt: timestamp('mqtt_session_connected_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('device_customer_idx').on(t.customerId),
    index('device_profile_idx').on(t.profileId),
    index('device_group_idx').on(t.groupId),
  ],
);

export const command = pgTable(
  'command',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['queued', 'sent', 'success', 'failed', 'timeout'] })
      .notNull()
      .default('queued'),
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    result: jsonb('result'),
    persistUntilOnline: boolean('persist_until_online').notNull().default(false),
    ttlS: integer('ttl_s').notNull().default(30),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('command_device_idx').on(t.deviceId, t.createdAt), index('command_status_idx').on(t.status)],
);

import type { OtaDeviceState, OtaJobStatus, OtaTarget, TariffPeriod } from '@perspice/shared';
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer, customerGroup } from './customers';
import { device, deviceProfile } from './devices';
import { user } from './users';

/** A firmware image for a profile's devices; the file is at `file_key` in storage. */
export const firmware = pgTable(
  'firmware',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => deviceProfile.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    fileKey: text('file_key').notNull(),
    sha256: text('sha256').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('firmware_profile_version_idx').on(t.profileId, t.version), index('firmware_profile_idx').on(t.profileId)],
);

/** A rollout of a firmware image (spec §4 `ota_job`). */
export const otaJob = pgTable('ota_job', {
  id: id(),
  firmwareId: uuid('firmware_id')
    .notNull()
    .references(() => firmware.id, { onDelete: 'restrict' }),
  status: text('status').$type<OtaJobStatus>().notNull().default('running'),
  target: jsonb('target').$type<OtaTarget>().notNull(),
  batchSize: integer('batch_size').notNull(),
  maxFailurePct: integer('max_failure_pct').notNull(),
  timeoutMin: integer('timeout_min').notNull(),
  haltReason: text('halt_reason'),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ...timestamps(),
});

/** One device's progress in a rollout. */
export const otaJobDevice = pgTable(
  'ota_job_device',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => otaJob.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    state: text('state').$type<OtaDeviceState>().notNull(),
    pct: doublePrecision('pct'),
    error: text('error'),
    /** When the OTA message was last sent (timeouts count from the first send). */
    firstSentAt: timestamp('first_sent_at', { withTimezone: true }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.deviceId] }), index('ota_job_device_device_idx').on(t.deviceId)],
);

/** A device's claim code (hashed; one per device, single-use). */
export const deviceClaim = pgTable('device_claim', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => device.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimedBy: uuid('claimed_by').references(() => user.id, { onDelete: 'set null' }),
  ...timestamps(),
});

/**
 * Provisioning keys: one secret in a profile's firmware lets every unit fetch its own device id
 * and token on first boot, identified by its serial (no per-device credentials in the image).
 */
export const provisioningKey = pgTable(
  'provisioning_key',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => deviceProfile.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 hex of the secret (`pps_…`), which is shown once. */
    secretHash: text('secret_hash').notNull().unique(),
    /** `create`: unknown serials become new devices; `preregistered`: only serials already registered. */
    mode: text('mode', { enum: ['create', 'preregistered'] }).notNull(),
    /** New devices join this customer (and group); unassigned when null. */
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerGroup.id, { onDelete: 'set null' }),
    tags: text('tags').array().notNull().default([]),
    /** Unassigned new devices get a claim code, returned to the device (e.g. for a label). */
    issueClaimCodes: boolean('issue_claim_codes').notNull().default(false),
    /** A device that provisioned before may fetch new credentials (its old token stops working). */
    allowReprovision: boolean('allow_reprovision').notNull().default(false),
    maxDevices: integer('max_devices'),
    provisionedCount: integer('provisioned_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('provisioning_key_profile_idx').on(t.profileId)],
);

/** Energy tariffs (spec §11): one per customer, and the platform default (scope 'platform'). */
export const tariff = pgTable('tariff', {
  /** 'platform' or the customer's id; one tariff each. */
  scope: text('scope').primaryKey(),
  customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
  currency: text('currency').notNull(),
  defaultRate: doublePrecision('default_rate').notNull(),
  periods: jsonb('periods').$type<TariffPeriod[]>().notNull().default([]),
  ...timestamps(),
});

/** A logged service of a device (spec §11 maintenance); resets its maintenance reminders. */
export const deviceService = pgTable(
  'device_service',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    servicedAt: timestamp('serviced_at', { withTimezone: true }).notNull(),
    note: text('note').notNull().default(''),
    /** Total run hours of each runtime key when it was done. */
    runHours: jsonb('run_hours').$type<Record<string, number>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('device_service_device_idx').on(t.deviceId, t.servicedAt)],
);

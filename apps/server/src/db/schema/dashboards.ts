import type { DashboardDefinition } from '@perspice/shared';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer } from './customers';
import { deviceProfile } from './devices';
import { user } from './users';

export const dashboardTemplate = pgTable(
  'dashboard_template',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['device', 'overview'] }).notNull(),
    profileId: uuid('profile_id').references(() => deviceProfile.id, { onDelete: 'cascade' }),
    definition: jsonb('definition').$type<DashboardDefinition>().notNull(),
    /** Incremented on every definition change; overrides remember the version they copied. */
    version: integer('version').notNull().default(1),
    builtIn: boolean('built_in').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index('dashboard_template_profile_idx').on(t.profileId)],
);

/** One per (template, customer); `customer_id` null is the platform's own instance. */
export const dashboardInstance = pgTable(
  'dashboard_instance',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => dashboardTemplate.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    overrideDefinition: jsonb('override_definition').$type<DashboardDefinition | null>(),
    overrideBaseVersion: integer('override_base_version'),
    ...timestamps(),
  },
  (t) => [
    unique('dashboard_instance_template_customer_uq').on(t.templateId, t.customerId).nullsNotDistinct(),
    index('dashboard_instance_customer_idx').on(t.customerId),
  ],
);

export const exportJob = pgTable(
  'export_job',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    format: text('format', { enum: ['csv', 'xlsx', 'pdf'] }).notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    rowCount: integer('row_count'),
    fileKey: text('file_key'),
    error: text('error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('export_job_user_idx').on(t.userId, t.createdAt), index('export_job_expires_idx').on(t.expiresAt)],
);

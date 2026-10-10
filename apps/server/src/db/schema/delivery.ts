import type { NotificationPreferences, NotifyChannel, ReportScheduleInput, WebhookEvent } from '@perspice/shared';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer } from './customers';
import { exportJob } from './dashboards';
import { user } from './users';

export const notificationPreference = pgTable('notification_preference', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  prefs: jsonb('prefs').$type<NotificationPreferences>().notNull(),
  ...timestamps(),
});

export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (t) => [index('push_subscription_user_idx').on(t.userId)],
);

/** Outbound webhooks; `customer_id` null = platform-wide (all customers' events). */
export const webhook = pgTable(
  'webhook',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** Encrypted with MASTER_KEY; shown to the user only when created or rotated. */
    secretEnc: text('secret_enc').notNull(),
    events: text('events').array().$type<WebhookEvent[]>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('webhook_customer_idx').on(t.customerId)],
);

/** Every notification send (and webhook call), for the admin delivery log and retries. */
export const deliveryLog = pgTable(
  'delivery_log',
  {
    id: id(),
    channel: text('channel').$type<NotifyChannel>().notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id').references(() => webhook.id, { onDelete: 'cascade' }),
    /** The tenant whose event this was (null = platform). */
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['queued', 'sent', 'failed', 'dead', 'held'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    index('delivery_log_customer_created_idx').on(t.customerId, t.createdAt),
    index('delivery_log_user_status_idx').on(t.userId, t.status),
  ],
);

export const reportSchedule = pgTable(
  'report_schedule',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    spec: jsonb('spec').$type<ReportScheduleInput>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status', { enum: ['ok', 'skipped', 'failed'] }),
    lastMessage: text('last_message'),
    lastJobId: uuid('last_job_id').references(() => exportJob.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('report_schedule_next_run_idx').on(t.nextRunAt)],
);

import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer } from './customers';
import { user } from './users';

export const notification = pgTable(
  'notification',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'critical'] })
      .notNull()
      .default('info'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.createdAt)],
);

export const emailTemplate = pgTable(
  'email_template',
  {
    id: id(),
    key: text('key').notNull(),
    /** Null = platform default override. */
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    bodyMjml: text('body_mjml').notNull(),
    ...timestamps(),
  },
  (t) => [unique('email_template_key_customer_uq').on(t.key, t.customerId).nullsNotDistinct()],
);

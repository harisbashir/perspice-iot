import { type AnyPgColumn, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';

export const customer = pgTable('customer', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  /** IANA zone for alarm schedules and reports of this customer's devices. */
  timezone: text('timezone').notNull().default('UTC'),
  parentCustomerId: uuid('parent_customer_id').references((): AnyPgColumn => customer.id),
  ...timestamps(),
});

export const customerGroup = pgTable(
  'customer_group',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => customerGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (t) => [index('customer_group_customer_idx').on(t.customerId)],
);

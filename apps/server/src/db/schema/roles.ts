import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Permission } from '@perspice/shared';
import { id, timestamps } from './_common';
import { customer } from './customers';

export const role = pgTable(
  'role',
  {
    id: id(),
    /** Set for built-in roles (e.g. `customer_admin`); null for custom roles. */
    key: text('key'),
    name: text('name').notNull(),
    scope: text('scope', { enum: ['platform', 'customer'] }).notNull(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    permissions: text('permissions').array().$type<Permission[]>().notNull().default([]),
    builtIn: boolean('built_in').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('role_key_uq').on(t.key), index('role_customer_idx').on(t.customerId)],
);

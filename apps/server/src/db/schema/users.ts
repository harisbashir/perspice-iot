import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer, customerGroup } from './customers';
import { role } from './roles';

export const user = pgTable(
  'user',
  {
    id: id(),
    /** Stored lower-cased; globally unique across platform and customers. */
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    scopeType: text('scope_type', { enum: ['platform', 'customer'] }).notNull(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerGroup.id, { onDelete: 'set null' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id),
    /** Encrypted with MASTER_KEY. */
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    status: text('status', { enum: ['invited', 'active', 'disabled'] })
      .notNull()
      .default('invited'),
    lastLogin: timestamp('last_login', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('user_customer_idx').on(t.customerId)],
);

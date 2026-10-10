import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Permission } from '@perspice/shared';
import { id } from './_common';
import { customer, customerGroup } from './customers';
import { user } from './users';

export const session = pgTable(
  'session',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId), index('session_family_idx').on(t.familyId)],
);

export const userToken = pgTable(
  'user_token',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['invite', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_token_user_idx').on(t.userId)],
);

export const apiKey = pgTable(
  'api_key',
  {
    id: id(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type', { enum: ['platform', 'customer'] }).notNull(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerGroup.id, { onDelete: 'set null' }),
    permissions: text('permissions').array().$type<Permission[]>().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsed: timestamp('last_used', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_key_customer_idx').on(t.customerId)],
);

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './_common';

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorType: text('actor_type', { enum: ['user', 'apikey', 'system', 'device'] }).notNull(),
    actorId: uuid('actor_id'),
    customerId: uuid('customer_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    diff: jsonb('diff'),
    ip: text('ip'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_customer_ts_idx').on(t.customerId, t.ts),
    index('audit_target_idx').on(t.targetType, t.targetId),
    index('audit_actor_idx').on(t.actorId),
  ],
);

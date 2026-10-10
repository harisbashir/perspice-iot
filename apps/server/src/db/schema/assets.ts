import type { AssetAttributeDef, AssetAttributeValue } from '@perspice/shared';
import { type AnyPgColumn, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer, customerGroup } from './customers';
import { dashboardTemplate } from './dashboards';
import { device } from './devices';

/** Platform-wide asset types (spec §4): attributes and the default asset dashboard. */
export const assetType = pgTable('asset_type', {
  id: id(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('building'),
  attributes: jsonb('attributes').$type<AssetAttributeDef[]>().notNull().default([]),
  defaultDashboardTemplateId: uuid('default_dashboard_template_id').references(() => dashboardTemplate.id, { onDelete: 'set null' }),
  ...timestamps(),
});

/** A customer's asset; a tree through `parent_id` (sub-assets block deletion). */
export const asset = pgTable(
  'asset',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerGroup.id, { onDelete: 'set null' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => assetType.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => asset.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    location: jsonb('location').$type<{ lat: number; lng: number } | null>(),
    attributes: jsonb('attributes').$type<Record<string, AssetAttributeValue>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [index('asset_customer_idx').on(t.customerId), index('asset_parent_idx').on(t.parentId)],
);

/** A device's asset (at most one). */
export const assetDevice = pgTable(
  'asset_device',
  {
    deviceId: uuid('device_id')
      .primaryKey()
      .references(() => device.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
  },
  (t) => [index('asset_device_asset_idx').on(t.assetId)],
);

import type { GeofenceShape } from '@perspice/shared';
import { doublePrecision, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { customer } from './customers';
import { device } from './devices';

/** Detected trips (spec §4 `trip`). `end_ts` is null while the trip is under way. */
export const trip = pgTable(
  'trip',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    startTs: timestamp('start_ts', { withTimezone: true }).notNull(),
    endTs: timestamp('end_ts', { withTimezone: true }),
    startLat: doublePrecision('start_lat').notNull(),
    startLng: doublePrecision('start_lng').notNull(),
    endLat: doublePrecision('end_lat'),
    endLng: doublePrecision('end_lng'),
    distanceM: doublePrecision('distance_m').notNull().default(0),
    maxSpeedKmh: doublePrecision('max_speed_kmh'),
    avgSpeedKmh: doublePrecision('avg_speed_kmh'),
    ...timestamps(),
  },
  (t) => [index('trip_device_start_idx').on(t.deviceId, t.startTs)],
);

/** Customer geofences, or platform-wide ones (`customer_id` null) that apply to every customer. */
export const geofence = pgTable(
  'geofence',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shape: jsonb('shape').$type<GeofenceShape>().notNull(),
    color: text('color').notNull().default('#2563eb'),
    /** Bounding box, for map-area queries. */
    minLat: doublePrecision('min_lat').notNull(),
    minLng: doublePrecision('min_lng').notNull(),
    maxLat: doublePrecision('max_lat').notNull(),
    maxLng: doublePrecision('max_lng').notNull(),
    ...timestamps(),
  },
  (t) => [index('geofence_customer_idx').on(t.customerId)],
);

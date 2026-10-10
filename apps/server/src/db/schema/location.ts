import { doublePrecision, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
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

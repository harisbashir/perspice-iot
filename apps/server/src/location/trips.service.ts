import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { LocationKeys, TripDto, TripSettings } from '@perspice/shared';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { customer, device, trip } from '../db/schema';
import { TELEMETRY_EVENTS_STREAM, type DomainEvent } from '../events/events';
import { StreamConsumer } from '../events/stream-consumer';
import { LocationService } from './location.service';
import { MAX_PLAUSIBLE_KMH, type TripEvent, type TripState, emptyTripState, stepTrip, timeoutTrip } from './trips';

const stateKey = (deviceId: string) => `trip:state:${deviceId}`;
/** Devices with a trip under way, scored by the time the sweep should look at them. */
const OPEN_TRIPS = 'trips:open';
/** Ended trips whose figures are recomputed from stored fixes once ingest has written them all. */
const FINALIZE = 'trips:finalize';
const FINALIZE_AFTER_MS = 30_000;
const STATE_TTL_S = 30 * 86_400;
const MIN_SWEEP_AGE_MS = 60_000;

interface StoredState extends TripState {
  profileId: string;
  tripId: string | null;
}

type TripRow = typeof trip.$inferSelect;

/** Fix-to-fix distances in metres (haversine), leaving out implausible jumps, as SQL. */
function segments(deviceId: string, keys: LocationKeys, from: number, to: number) {
  const pick = (k: string) => sql`max(value_num) FILTER (WHERE key = ${k})`;
  return sql`
    WITH f AS (
      SELECT ts, ${pick(keys.lat)} AS lat, ${pick(keys.lng)} AS lng, ${pick(keys.speed)} AS speed
      FROM telemetry
      WHERE device_id = ${deviceId} AND key IN (${keys.lat}, ${keys.lng}, ${keys.speed})
        AND ts >= to_timestamp(${from} / 1000.0) AND ts <= to_timestamp(${to} / 1000.0)
      GROUP BY ts
    ), g AS (
      SELECT ts, lat, lng, speed, lag(ts) OVER w AS pts, lag(lat) OVER w AS plat, lag(lng) OVER w AS plng
      FROM f
      WHERE lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 AND NOT (lat = 0 AND lng = 0)
      WINDOW w AS (ORDER BY ts)
    ), d AS (
      SELECT ts, speed,
        CASE WHEN pts IS NULL THEN 0 ELSE 2 * 6371000 * asin(least(1, sqrt(
          power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2)
        ))) END AS m,
        extract(epoch FROM ts - pts) AS dt
      FROM g
    )
    SELECT ts, speed, m, dt FROM d WHERE dt IS NULL OR (dt > 0 AND m / dt * 3.6 <= ${MAX_PLAUSIBLE_KMH})`;
}

/**
 * Trips (spec §11 fleet). The rules role follows each reported-location device through the
 * `device.location` events with the pure state machine in `trips.ts`; when a trip ends, its
 * distance and speeds are computed from all stored fixes in it. The scheduler closes trips of
 * devices that went quiet.
 */
@Injectable()
export class TripsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TripsService.name);
  private consumer?: StreamConsumer;

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly location: LocationService,
    @Inject('RUN_TRIPS') private readonly consume: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.consume) return;
    this.consumer = new StreamConsumer(this.redis, { group: 'trips', stream: TELEMETRY_EVENTS_STREAM, handle: (e) => this.handle(e) });
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }

  async handle(e: DomainEvent): Promise<void> {
    if (e.type !== 'device.location') return;
    const profile = await this.location.profileLocation(e.profileId);
    if (!profile.trips.enabled) return;
    await this.withLock(e.deviceId, async () => {
      const state = await this.load(e.deviceId, e.profileId);
      const r = stepTrip(
        state,
        { ts: e.ts, ...(e.fix ? { fix: e.fix, speed: e.fix.speed } : {}), ...(e.ignition !== undefined ? { ignition: e.ignition } : {}) },
        profile.trips,
      );
      await this.apply(e.deviceId, { ...state, ...r.state }, r.events, profile.keys, profile.trips);
    });
  }

  /** Closes trips of devices that stopped moving (or reporting). `now` is injectable for tests. */
  async sweep(now = Date.now()): Promise<number> {
    const due = await this.redis.zrangebyscore(OPEN_TRIPS, 0, now - MIN_SWEEP_AGE_MS, 'LIMIT', 0, 1000);
    let closed = 0;
    for (const deviceId of due) {
      await this.withLock(deviceId, async () => {
        const raw = await this.redis.get(stateKey(deviceId));
        if (!raw) {
          await this.redis.zrem(OPEN_TRIPS, deviceId);
          return;
        }
        const state = JSON.parse(raw) as StoredState;
        const profile = await this.location.profileLocation(state.profileId);
        const r = timeoutTrip(state, now, profile.trips);
        if (r.events.length) closed++;
        await this.apply(deviceId, { ...state, ...r.state }, r.events, profile.keys, profile.trips);
      }).catch((err: Error) => this.logger.error(`Trip sweep for ${deviceId} failed: ${err.message}`));
    }
    for (const tripId of await this.redis.zrangebyscore(FINALIZE, 0, now, 'LIMIT', 0, 1000)) {
      await this.finalize(tripId).catch((err: Error) => this.logger.error(`Trip ${tripId} figures failed: ${err.message}`));
      await this.redis.zrem(FINALIZE, tripId);
    }
    return closed;
  }

  private async load(deviceId: string, profileId: string): Promise<StoredState> {
    const raw = await this.redis.get(stateKey(deviceId));
    return raw ? { ...(JSON.parse(raw) as StoredState), profileId } : { ...emptyTripState(), profileId, tripId: null };
  }

  private async apply(deviceId: string, state: StoredState, events: TripEvent[], keys: LocationKeys, s: TripSettings): Promise<void> {
    for (const ev of events) {
      if (ev.kind === 'start') {
        const [row] = await this.db
          .insert(trip)
          .values({ deviceId, startTs: new Date(ev.ts), startLat: ev.at.lat, startLng: ev.at.lng })
          .returning({ id: trip.id });
        state.tripId = row!.id;
      } else if (state.tripId) {
        await this.end(state.tripId, ev.ts, ev.at, ev.trip);
        state.tripId = null;
      }
    }
    await this.redis.set(stateKey(deviceId), JSON.stringify(state), 'EX', STATE_TTL_S);
    if (state.phase === 'moving') {
      const since = (s.ignitionKey ? state.last?.ts : state.lastMoveTs) ?? Date.now();
      await this.redis.zadd(OPEN_TRIPS, since + s.stopAfterS * 1000, deviceId);
    } else {
      await this.redis.zrem(OPEN_TRIPS, deviceId);
    }
  }

  /** Ends the trip with the live figures, and queues the recomputation from stored fixes. */
  private async end(tripId: string, endTs: number, at: { lat: number; lng: number }, live: { distanceM: number; maxSpeedKmh: number }): Promise<void> {
    const row = await this.db.query.trip.findFirst({ where: eq(trip.id, tripId), columns: { startTs: true } });
    if (!row) return;
    const hours = (endTs - row.startTs.getTime()) / 3_600_000;
    const distanceM = live.distanceM;
    await this.db
      .update(trip)
      .set({
        endTs: new Date(endTs),
        endLat: at.lat,
        endLng: at.lng,
        distanceM,
        maxSpeedKmh: live.maxSpeedKmh || null,
        avgSpeedKmh: hours > 0 ? distanceM / 1000 / hours : null,
      })
      .where(eq(trip.id, tripId));
    await this.redis.zadd(FINALIZE, Date.now() + FINALIZE_AFTER_MS, tripId);
  }

  /** Final figures from all stored fixes between start and end (batched messages included). */
  async finalize(tripId: string): Promise<void> {
    const row = await this.db.query.trip.findFirst({ where: eq(trip.id, tripId) });
    if (!row?.endTs) return;
    const [d] = await this.db.select({ profileId: device.profileId }).from(device).where(eq(device.id, row.deviceId));
    if (!d) return;
    const { keys } = await this.location.profileLocation(d.profileId);
    const deviceId = row.deviceId;
    const endTs = row.endTs.getTime();
    const start = row.startTs.getTime();
    const stats = await this.db.execute<{ distance: number | null; max_reported: number | null; max_implied: number | null }>(sql`
      SELECT sum(m) AS distance, max(speed) AS max_reported, max(CASE WHEN dt > 0 THEN m / dt * 3.6 END) AS max_implied
      FROM (${segments(deviceId, keys, start, endTs)}) s`);
    const st = stats.rows[0];
    const distanceM = Number(st?.distance ?? 0);
    const hours = (endTs - start) / 3_600_000;
    const maxSpeed = st?.max_reported ?? st?.max_implied ?? null;
    await this.db
      .update(trip)
      .set({
        distanceM,
        maxSpeedKmh: maxSpeed === null ? null : Number(maxSpeed),
        avgSpeedKmh: hours > 0 ? distanceM / 1000 / hours : null,
      })
      .where(eq(trip.id, tripId));
  }

  /** Trips overlapping a range, newest first; a trip under way shows its live distance. */
  async list(deviceId: string, from: number, to: number, limit: number): Promise<TripDto[]> {
    const rows = await this.db
      .select()
      .from(trip)
      .where(and(eq(trip.deviceId, deviceId), lte(trip.startTs, new Date(to)), or(isNull(trip.endTs), gte(trip.endTs, new Date(from)))))
      .orderBy(desc(trip.startTs))
      .limit(limit);
    const open = rows.some((r) => !r.endTs) ? await this.redis.get(stateKey(deviceId)) : null;
    const live = open ? (JSON.parse(open) as StoredState) : null;
    return rows.map((r) => toDto(r, live?.tripId === r.id ? live : null));
  }

  /** Distance travelled within trips per local day of the device's customer. */
  async distancePerDay(deviceId: string, profileId: string, from: number, to: number): Promise<{ timezone: string; days: { day: string; distanceM: number }[] }> {
    const [row] = await this.db
      .select({ timezone: customer.timezone })
      .from(device)
      .leftJoin(customer, eq(customer.id, device.customerId))
      .where(eq(device.id, deviceId));
    const timezone = row?.timezone ?? 'UTC';
    const { keys } = await this.location.profileLocation(profileId);
    const res = await this.db.execute<{ day: string; distance: number }>(sql`
      SELECT to_char(s.ts AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, sum(s.m) AS distance
      FROM (${segments(deviceId, keys, from, to)}) s
      JOIN trip t ON t.device_id = ${deviceId} AND s.ts > t.start_ts AND s.ts <= coalesce(t.end_ts, now())
      GROUP BY 1 HAVING sum(s.m) > 0 ORDER BY 1`);
    return { timezone, days: res.rows.map((r) => ({ day: r.day, distanceM: Number(r.distance) })) };
  }

  /** One update per device at a time, across rules instances. */
  private async withLock(deviceId: string, fn: () => Promise<void>): Promise<void> {
    const lock = `lock:trip:${deviceId}`;
    const token = `${process.pid}-${Math.random()}`;
    for (let i = 0; ; i++) {
      if (await this.redis.set(lock, token, 'PX', 10_000, 'NX')) break;
      if (i > 250) throw new Error(`Device ${deviceId} is busy`);
      await new Promise((r) => setTimeout(r, 20));
    }
    try {
      await fn();
    } finally {
      if ((await this.redis.get(lock)) === token) await this.redis.del(lock);
    }
  }
}

function toDto(r: TripRow, live: StoredState | null): TripDto {
  return {
    id: r.id,
    deviceId: r.deviceId,
    startTs: r.startTs.getTime(),
    endTs: r.endTs?.getTime() ?? null,
    start: { lat: r.startLat, lng: r.startLng },
    end: r.endLat !== null && r.endLng !== null ? { lat: r.endLat, lng: r.endLng } : null,
    distanceM: live?.trip ? live.trip.distanceM : r.distanceM,
    maxSpeedKmh: live?.trip ? live.trip.maxSpeedKmh : r.maxSpeedKmh,
    avgSpeedKmh: r.avgSpeedKmh,
  };
}

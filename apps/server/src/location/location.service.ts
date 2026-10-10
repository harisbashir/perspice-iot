import { Inject, Injectable } from '@nestjs/common';
import {
  type DeviceLocationDto,
  type Fix,
  type LocationKeys,
  LocationKeysSchema,
  type TripSettings,
  TripSettingsSchema,
  extractFix,
  isValidFix,
} from '@perspice/shared';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { device, deviceProfile } from '../db/schema';
import type { TelemetryRow } from '../ingest/normalize';

export const locationKey = (deviceId: string) => `loc:${deviceId}`;
/** Fixes not yet written to `device.location` (device id → JSON), flushed by the scheduler. */
export const PENDING_LOCATIONS = 'loc:pending';
const PROFILE_TTL_MS = 60_000;
/** The stored copy is refreshed once the newest fix is this much newer. */
const WRITE_BACK_AFTER_MS = 60_000;
const MAX_ROUTE_POINTS = 10_000;

/** Sets `loc:{id}` only if the fix is newer, and marks it pending for the database. */
const SET_IF_NEWER = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(cjson.decode(current).ts) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[2])
return 1`;

/** Removes pending entries that are still exactly what was flushed. */
const DELETE_IF_UNCHANGED = `
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then redis.call('HDEL', KEYS[1], ARGV[i]) end
end
return 0`;

type LocationRedis = Redis & {
  perspiceSetLocation(key: string, pending: string, ts: string, json: string, id: string): Promise<number>;
  perspiceDeleteIfUnchanged(pending: string, ...pairs: string[]): Promise<number>;
};

export interface ReportOutcome {
  /** A fix newer than the current one, now stored. */
  fix?: DeviceLocationDto;
  /** Why a fix in the message was refused. */
  rejected?: string;
  /** The message's ignition value, when the profile's trips use an ignition key. */
  ignition?: { ts: number; value: boolean };
}

export interface ProfileLocation {
  mode: 'none' | 'fixed' | 'reported';
  keys: LocationKeys;
  trips: TripSettings;
  at: number;
}

export interface RoutePoint extends Fix {
  ts: number;
}

/**
 * Device locations (spec R12). Reported fixes come from telemetry (keys per profile); Redis
 * holds the newest one exactly and the scheduler writes it to `device.location` once the stored
 * copy is a minute behind. Fixed locations are written directly.
 */
@Injectable()
export class LocationService {
  private readonly redis: LocationRedis;
  private readonly profiles = new Map<string, ProfileLocation>();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) redis: Redis,
  ) {
    if (!('perspiceSetLocation' in redis)) {
      redis.defineCommand('perspiceSetLocation', { numberOfKeys: 2, lua: SET_IF_NEWER });
      redis.defineCommand('perspiceDeleteIfUnchanged', { numberOfKeys: 1, lua: DELETE_IF_UNCHANGED });
    }
    this.redis = redis as LocationRedis;
  }

  /** The profile's location settings, cached for a minute. */
  async profileLocation(profileId: string): Promise<ProfileLocation> {
    const cached = this.profiles.get(profileId);
    if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached;
    const row = await this.db.query.deviceProfile.findFirst({
      where: eq(deviceProfile.id, profileId),
      columns: { locationMode: true, locationKeys: true, tripSettings: true },
    });
    const entry: ProfileLocation = {
      mode: row?.locationMode ?? 'none',
      keys: LocationKeysSchema.parse(row?.locationKeys ?? {}),
      trips: TripSettingsSchema.parse(row?.tripSettings ?? {}),
      at: Date.now(),
    };
    this.profiles.set(profileId, entry);
    return entry;
  }

  /** Takes the newest valid fix from a message's rows (ingest hot path: Redis only). */
  async report(deviceId: string, profileId: string, rows: TelemetryRow[]): Promise<ReportOutcome> {
    const profile = await this.profileLocation(profileId);
    if (profile.mode !== 'reported') return {};
    const byTs = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      const values = byTs.get(r.ts) ?? {};
      values[r.key] = r.valueNum ?? r.valueStr ?? r.valueBool ?? r.valueJson;
      byTs.set(r.ts, values);
    }
    let newest: { ts: number; fix: Fix } | null = null;
    let rejected: string | undefined;
    let ignition: ReportOutcome['ignition'];
    const ignitionKey = profile.trips.enabled ? profile.trips.ignitionKey : undefined;
    for (const [ts, values] of byTs) {
      if (ignitionKey && typeof values[ignitionKey] === 'boolean' && (!ignition || ts > ignition.ts)) {
        ignition = { ts, value: values[ignitionKey] as boolean };
      }
      if (!(profile.keys.lat in values) && !(profile.keys.lng in values)) continue;
      const fix = extractFix(values, profile.keys);
      if (!fix) {
        if (profile.keys.lat in values && profile.keys.lng in values) {
          rejected = `Rejected location ${String(values[profile.keys.lat])}, ${String(values[profile.keys.lng])}: not a valid position`;
        }
        continue;
      }
      if (!newest || ts > newest.ts) newest = { ts, fix };
    }
    const out: ReportOutcome = { ...(rejected ? { rejected } : {}), ...(ignition ? { ignition } : {}) };
    if (!newest) return out;
    const loc: DeviceLocationDto = { ...newest.fix, ts: newest.ts, source: 'reported' };
    const json = JSON.stringify(loc);
    const set = await this.redis.perspiceSetLocation(locationKey(deviceId), PENDING_LOCATIONS, String(newest.ts), json, deviceId);
    return set ? { ...out, fix: loc } : out;
  }

  async current(deviceId: string): Promise<DeviceLocationDto | null> {
    const raw = await this.redis.get(locationKey(deviceId));
    if (raw) return JSON.parse(raw) as DeviceLocationDto;
    const row = await this.db.query.device.findFirst({ where: eq(device.id, deviceId), columns: { location: true } });
    return row?.location ?? null;
  }

  /** Sets a location by hand. Written to the database at once. */
  async setFixed(deviceId: string, profileId: string, input: { lat: number; lng: number; alt?: number }): Promise<DeviceLocationDto> {
    const { mode } = await this.profileLocation(profileId);
    if (mode === 'none') throw validation([{ path: [], message: "This device's profile doesn't use locations" }]);
    if (!isValidFix(input)) throw validation([{ path: ['lat'], message: 'Not a valid location' }]);
    const loc: DeviceLocationDto = { lat: input.lat, lng: input.lng, ...(input.alt !== undefined ? { alt: input.alt } : {}), ts: Date.now(), source: 'fixed' };
    await this.db.update(device).set({ location: loc }).where(eq(device.id, deviceId));
    await this.redis.multi().set(locationKey(deviceId), JSON.stringify(loc)).hdel(PENDING_LOCATIONS, deviceId).exec();
    return loc;
  }

  async clear(deviceId: string): Promise<void> {
    await this.db.update(device).set({ location: null }).where(eq(device.id, deviceId));
    await this.redis.multi().del(locationKey(deviceId)).hdel(PENDING_LOCATIONS, deviceId).exec();
  }

  /**
   * Writes pending fixes whose stored copy is at least a minute older. The rest stay pending
   * for a later flush, so the newest fix always reaches the database eventually.
   */
  async flush(): Promise<number> {
    const pending = await this.redis.hgetall(PENDING_LOCATIONS);
    const entries = Object.entries(pending);
    if (!entries.length) return 0;
    const ids = entries.map(([id]) => id);
    const locs = entries.map(([, json]) => json);
    // Done: written now, already stored (same or newer), or the device is gone.
    const res = await this.db.execute<{ id: string; written: boolean }>(sql`
      WITH v AS (
        SELECT * FROM unnest(${sql.param(ids)}::uuid[], ${sql.param(locs)}::jsonb[]) AS v(id, loc)
      ), u AS (
        UPDATE device d SET location = v.loc FROM v
        WHERE d.id = v.id AND (d.location IS NULL OR (d.location->>'ts')::bigint <= (v.loc->>'ts')::bigint - ${WRITE_BACK_AFTER_MS})
        RETURNING d.id
      )
      SELECT v.id, v.id IN (SELECT id FROM u) AS written FROM v LEFT JOIN device d ON d.id = v.id
      WHERE d.id IS NULL OR v.id IN (SELECT id FROM u) OR (d.location->>'ts')::bigint >= (v.loc->>'ts')::bigint`);
    if (res.rows.length) {
      const pairs = res.rows.flatMap((r) => [r.id, pending[r.id]!]);
      await this.redis.perspiceDeleteIfUnchanged(PENDING_LOCATIONS, ...pairs);
    }
    return res.rows.filter((r) => r.written).length;
  }

  /** Fixes from telemetry over a range, oldest first; time-bucketed beyond 10,000 fixes. */
  async route(deviceId: string, profileId: string, from: number, to: number): Promise<{ points: RoutePoint[]; downsampled: boolean }> {
    const { keys } = await this.profileLocation(profileId);
    const range = sql`device_id = ${deviceId} AND ts >= to_timestamp(${from} / 1000.0) AND ts <= to_timestamp(${to} / 1000.0)`;
    const count = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM telemetry WHERE ${range} AND key = ${keys.lat}`,
    );
    const downsampled = (count.rows[0]?.n ?? 0) > MAX_ROUTE_POINTS;
    const bucketMs = downsampled ? Math.ceil((to - from) / MAX_ROUTE_POINTS) : 0;
    const pick = (k: string) => sql`max(value_num) FILTER (WHERE key = ${k})`;
    const fixes = sql`
      SELECT ts, ${pick(keys.lat)} AS lat, ${pick(keys.lng)} AS lng, ${pick(keys.alt)} AS alt, ${pick(keys.speed)} AS speed,
             ${pick(keys.heading)} AS heading, ${pick(keys.accuracy)} AS accuracy
      FROM telemetry
      WHERE ${range} AND key IN (${keys.lat}, ${keys.lng}, ${keys.alt}, ${keys.speed}, ${keys.heading}, ${keys.accuracy})
      GROUP BY ts`;
    const rows = await this.db.execute<{ ts: Date | string; lat: number | null; lng: number | null } & Record<string, number | null>>(
      downsampled
        ? sql`SELECT DISTINCT ON (time_bucket(${`${bucketMs} milliseconds`}::interval, ts)) * FROM (${fixes}) f
              WHERE lat IS NOT NULL AND lng IS NOT NULL
              ORDER BY time_bucket(${`${bucketMs} milliseconds`}::interval, ts), ts DESC`
        : sql`SELECT * FROM (${fixes}) f WHERE lat IS NOT NULL AND lng IS NOT NULL ORDER BY ts`,
    );
    const points = rows.rows
      .map((r) => {
        const p: RoutePoint = { ts: new Date(r.ts).getTime(), lat: Number(r.lat), lng: Number(r.lng) };
        for (const k of ['alt', 'speed', 'heading', 'accuracy'] as const) if (r[k] !== null && r[k] !== undefined) p[k] = Number(r[k]);
        return p;
      })
      .filter((p) => isValidFix(p))
      .sort((a, b) => a.ts - b.ts);
    return { points, downsampled };
  }

  /** Current locations of many devices (Redis first), for device lists and maps. */
  async currentMany(rows: { id: string; location: DeviceLocationDto | null }[]): Promise<(DeviceLocationDto | null)[]> {
    if (!rows.length) return [];
    const raw = await this.redis.mget(...rows.map((r) => locationKey(r.id)));
    return rows.map((r, i) => (raw[i] ? (JSON.parse(raw[i]!) as DeviceLocationDto) : r.location));
  }
}

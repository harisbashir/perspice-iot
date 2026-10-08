import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeviceStatus } from '@perspice/shared';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { device } from '../db/schema';
import { type EffectiveTimeouts, DevicesService, PRESENCE_LAST_SEEN } from '../devices/devices.service';
import { EventBus } from '../events/event-bus';
import type { PresenceTouch, SessionEvents } from '../ingest/ports';

const statusKey = (id: string) => `status:${id}`;
const sessionKey = (id: string) => `session:${id}`;
export const timeoutsKey = (id: string) => `timeouts:${id}`;
const PENDING_LAST_SEEN = 'presence:pending';
const TIMEOUTS_TTL_S = 60;

/** Pure status rule for the sweep: only activity brings a device online (spec §5.3). */
export function nextStatus(
  current: DeviceStatus,
  lastSeen: number | null,
  now: number,
  t: { offlineS: number; deadS: number },
): DeviceStatus {
  if (lastSeen === null) return current === 'never' ? 'never' : current;
  const idle = now - lastSeen;
  if (idle >= t.deadS * 1000) return 'dead';
  if (idle >= t.offlineS * 1000) return current === 'dead' ? 'dead' : 'offline';
  return current;
}

/** Compare-and-set the cached status; returns the previous value ('' if unknown) or null if unchanged. */
const SET_STATUS = `
local cur = redis.call('HGET', KEYS[1], 'status')
if cur == ARGV[1] then return nil end
redis.call('HSET', KEYS[1], 'status', ARGV[1])
return cur or ''`;

/** Stores the session's connected_at only if it is the newest seen. */
const SET_SESSION = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if tonumber(ARGV[1]) >= cur then redis.call('SET', KEYS[1], ARGV[1], 'EX', 2592000) return 1 end
return 0`;

@Injectable()
export class PresenceService implements PresenceTouch, SessionEvents {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly devices: DevicesService,
    private readonly events: EventBus,
  ) {}

  async touch(deviceId: string, ts: number): Promise<void> {
    const [, , [, status]] = (await this.redis
      .multi()
      .zadd(PRESENCE_LAST_SEEN, 'GT', ts, deviceId)
      .hset(PENDING_LAST_SEEN, deviceId, String(ts))
      .hget(statusKey(deviceId), 'status')
      .exec()) as [unknown, unknown, [Error | null, string | null]];
    if (status !== 'online') await this.transition(deviceId, 'online', 'activity');
  }

  async onConnected(deviceId: string, connectedAt: number): Promise<void> {
    await this.redis.eval(SET_SESSION, 1, sessionKey(deviceId), String(connectedAt));
    await this.db
      .update(device)
      .set({ mqttSessionConnectedAt: new Date(connectedAt) })
      .where(eq(device.id, deviceId));
    await this.redis.zadd(PRESENCE_LAST_SEEN, 'GT', Date.now(), deviceId);
    await this.transition(deviceId, 'online', 'mqtt_connected');
  }

  /** Review Focus 2: a disconnect for an older session than the stored one is ignored. */
  async onDisconnected(deviceId: string, connectedAt: number, reason: string): Promise<void> {
    const current = Number((await this.redis.get(sessionKey(deviceId))) ?? '0');
    if (connectedAt < current) {
      this.logger.debug(`Ignoring stale disconnect for ${deviceId}`);
      return;
    }
    const timeouts = await this.timeouts(deviceId);
    if (!timeouts || timeouts.sleepy) return;
    await this.transition(deviceId, 'offline', `mqtt_disconnected:${reason}`);
  }

  /** Changes status if different; persists, emits `device.status_changed` and pushes to websockets. */
  async transition(deviceId: string, to: DeviceStatus, reason: string): Promise<boolean> {
    let from = (await this.redis.eval(SET_STATUS, 1, statusKey(deviceId), to)) as string | null;
    if (from === null) return false;
    const [row] = await this.db
      .update(device)
      .set({ status: to })
      .where(eq(device.id, deviceId))
      .returning({ customerId: device.customerId, prev: sql<DeviceStatus>`(SELECT status FROM device WHERE id = ${deviceId})` });
    if (!row) {
      await this.redis.del(statusKey(deviceId));
      return false;
    }
    if (from === '') from = row.prev; // first transition since Redis was empty: use the DB value
    if (from === to) return false;
    const ts = Date.now();
    const event = { type: 'device.status_changed' as const, deviceId, customerId: row.customerId, from: from as DeviceStatus, to, reason, ts };
    const message = JSON.stringify({ deviceId, from, to, ts });
    await Promise.all([
      this.events.publish(event),
      this.redis.publish('ws:status:platform', message),
      row.customerId ? this.redis.publish(`ws:status:${row.customerId}`, message) : undefined,
    ]);
    return true;
  }

  /** Writes recently seen timestamps back to Postgres in one statement (every 10 s). */
  async flushLastSeen(): Promise<number> {
    const flushing = `${PENDING_LAST_SEEN}:flushing`;
    try {
      await this.redis.rename(PENDING_LAST_SEEN, flushing);
    } catch {
      return 0; // nothing pending
    }
    const pending = await this.redis.hgetall(flushing);
    await this.redis.del(flushing);
    const rows = Object.entries(pending).filter(([id]) => isUuid(id));
    if (!rows.length) return 0;
    const values = sql.join(
      rows.map(([id, ts]) => sql`(${id}::uuid, to_timestamp(${Number(ts) / 1000}))`),
      sql`, `,
    );
    await this.db.execute(sql`
      UPDATE device SET last_seen = v.ts
      FROM (VALUES ${values}) AS v(id, ts)
      WHERE device.id = v.id AND (device.last_seen IS NULL OR device.last_seen < v.ts)`);
    return rows.length;
  }

  /** Effective timeouts, cached briefly for the sweep and disconnect handling. */
  async timeouts(deviceId: string): Promise<EffectiveTimeouts | null> {
    const cached = await this.redis.get(timeoutsKey(deviceId));
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as EffectiveTimeouts);
    const t = await this.devices.timeoutsFor(deviceId);
    await this.redis.set(timeoutsKey(deviceId), t ? JSON.stringify(t) : 'none', 'EX', TIMEOUTS_TTL_S);
    return t;
  }

  async currentStatus(deviceId: string): Promise<DeviceStatus> {
    const cached = await this.redis.hget(statusKey(deviceId), 'status');
    if (cached) return cached as DeviceStatus;
    const row = await this.db.query.device.findFirst({ where: eq(device.id, deviceId), columns: { status: true } });
    return row?.status ?? 'never';
  }
}

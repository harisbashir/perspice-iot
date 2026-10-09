import { Inject, Injectable } from '@nestjs/common';
import type { LatestValue } from '@perspice/shared';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { LATEST_KEY } from '../devices/devices.service';
import type { TelemetryRow } from './normalize';

/** Sets each field only if its ts is newer; returns the fields that changed as a flat list. */
const UPDATE_IF_NEWER = `
local changed = {}
for i = 1, #ARGV, 3 do
  local field, ts, value = ARGV[i], tonumber(ARGV[i + 1]), ARGV[i + 2]
  local current = redis.call('HGET', KEYS[1], field)
  if not current or tonumber(cjson.decode(current).ts) < ts then
    redis.call('HSET', KEYS[1], field, value)
    table.insert(changed, field)
    table.insert(changed, value)
  end
end
return changed`;

const valueOf = (r: TelemetryRow): unknown => r.valueNum ?? r.valueStr ?? r.valueBool ?? r.valueJson;

type WithUpdateIfNewer = Redis & { perspiceUpdateIfNewer(key: string, ...args: string[]): Promise<string[]> };

@Injectable()
export class LatestCache {
  private readonly redis: WithUpdateIfNewer;

  constructor(@Inject(REDIS) redis: Redis) {
    // A defined command runs by SHA (EVALSHA) instead of sending the script with every call.
    if (!('perspiceUpdateIfNewer' in redis)) redis.defineCommand('perspiceUpdateIfNewer', { numberOfKeys: 1, lua: UPDATE_IF_NEWER });
    this.redis = redis as WithUpdateIfNewer;
  }

  /** Updates `latest:{deviceId}` with values newer than the cached ones; returns those values. */
  async update(deviceId: string, rows: TelemetryRow[]): Promise<Record<string, LatestValue>> {
    const newest = new Map<string, TelemetryRow>();
    for (const r of rows) {
      const cur = newest.get(r.key);
      if (!cur || r.ts >= cur.ts) newest.set(r.key, r);
    }
    const args: string[] = [];
    for (const r of newest.values()) args.push(r.key, String(r.ts), JSON.stringify({ ts: r.ts, v: valueOf(r) }));
    const changed = await this.redis.perspiceUpdateIfNewer(LATEST_KEY(deviceId), ...args);
    const out: Record<string, LatestValue> = {};
    for (let i = 0; i < changed.length; i += 2) out[changed[i]!] = JSON.parse(changed[i + 1]!) as LatestValue;
    return out;
  }

  async get(deviceId: string): Promise<Record<string, LatestValue>> {
    const hash = await this.redis.hgetall(LATEST_KEY(deviceId));
    return Object.fromEntries(Object.entries(hash).map(([k, v]) => [k, JSON.parse(v) as LatestValue]));
  }
}

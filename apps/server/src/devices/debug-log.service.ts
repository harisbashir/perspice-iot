import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';

export const DEBUG_LOG_SIZE = 100;
const MAX_RAW = 2048;

export interface DebugEntry {
  ts: number;
  kind: 'telemetry' | 'attributes' | 'rejected' | 'connect' | 'disconnect' | 'command' | 'ts_adjusted';
  summary: string;
  raw?: string;
}

const key = (deviceId: string) => `debug:${deviceId}`;

/** Per-device ring of recent raw messages and rejections, shown in the device "Debug" tab. */
@Injectable()
export class DebugLogService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async push(deviceId: string, entry: DebugEntry): Promise<void> {
    const stored = { ...entry, raw: entry.raw?.slice(0, MAX_RAW) };
    await this.redis
      .pipeline() // no atomicity needed: one round trip, no MULTI/EXEC
      .lpush(key(deviceId), JSON.stringify(stored))
      .ltrim(key(deviceId), 0, DEBUG_LOG_SIZE - 1)
      .expire(key(deviceId), 7 * 24 * 3600)
      .exec();
  }

  async list(deviceId: string): Promise<DebugEntry[]> {
    const rows = await this.redis.lrange(key(deviceId), 0, DEBUG_LOG_SIZE - 1);
    return rows.map((r) => JSON.parse(r) as DebugEntry);
  }

  async clear(deviceId: string): Promise<void> {
    await this.redis.del(key(deviceId));
  }
}

import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { PRESENCE_LAST_SEEN } from '../devices/devices.service';
import { JobRegistry } from '../scheduler/job-registry';
import { PresenceService, nextStatus } from './presence.service';

const PAGE = 1000;
export const SWEEP_INTERVAL_MS = 30_000;
export const FLUSH_INTERVAL_MS = 10_000;

/** Every 30 s, marks idle devices offline/dead (spec §5.3). Registered in the scheduler role. */
@Injectable()
export class OfflineSweepJob implements OnApplicationBootstrap {
  private minTimeout?: { value: number; at: number };

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly presence: PresenceService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_PRESENCE_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.schedule) return;
    this.jobs.every('presence-sweep', SWEEP_INTERVAL_MS, async () => {
      await this.sweep();
    });
    this.jobs.every('presence-flush', FLUSH_INTERVAL_MS, async () => {
      await this.presence.flushLastSeen();
    });
  }

  /** Returns the number of transitions made. `now` is injectable for tests. */
  async sweep(now = Date.now()): Promise<number> {
    const cutoff = now - (await this.minOfflineTimeoutS()) * 1000;
    let changed = 0;
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.redis.zrangebyscore(PRESENCE_LAST_SEEN, '-inf', `(${cutoff}`, 'WITHSCORES', 'LIMIT', offset, PAGE);
      if (!page.length) break;
      for (let i = 0; i < page.length; i += 2) {
        const id = page[i]!;
        const lastSeen = Number(page[i + 1]);
        const current = await this.presence.currentStatus(id);
        if (current === 'dead' || current === 'never') continue;
        const timeouts = await this.presence.timeouts(id);
        if (!timeouts) {
          await this.redis.zrem(PRESENCE_LAST_SEEN, id); // device was deleted
          continue;
        }
        const next = nextStatus(current, lastSeen, now, timeouts);
        if (next !== current && (await this.presence.transition(id, next, 'inactivity'))) changed++;
      }
      if (page.length < PAGE * 2) break;
    }
    return changed;
  }

  /** The smallest effective offline timeout, so the sweep only scans possible candidates. */
  private async minOfflineTimeoutS(): Promise<number> {
    if (this.minTimeout && Date.now() - this.minTimeout.at < 60_000) return this.minTimeout.value;
    const res = await this.db.execute<{ min: number | null }>(
      sql`SELECT min(coalesce(d.offline_timeout_s, p.offline_timeout_s))::int AS min
          FROM device d JOIN device_profile p ON p.id = d.profile_id`,
    );
    const value = res.rows[0]?.min ?? 10;
    this.minTimeout = { value, at: Date.now() };
    return value;
  }
}

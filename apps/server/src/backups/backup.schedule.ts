import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { nextRun } from '../schedules/next-run';
import { JobRegistry } from '../scheduler/job-registry';
import { BackupService } from './backup.service';

const NEXT_KEY = 'backup:next-run';

/** Every minute (scheduler role): starts the daily backup when it is due. */
@Injectable()
export class BackupScheduleJob implements OnApplicationBootstrap {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly backups: BackupService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_BACKUPS') private readonly enabled: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.enabled) this.jobs.every('backup-schedule', 60_000, () => this.tick().then(() => undefined));
  }

  /** Returns true when a backup was queued. */
  async tick(now = Date.now()): Promise<boolean> {
    if (!this.backups.configured) return false;
    const s = await this.backups.schedule();
    if (!s.enabled) return false;
    const stored = Number(await this.redis.get(NEXT_KEY));
    const due = stored || nextRun({ kind: 'daily', time: s.time }, s.timezone, now);
    if (!stored) await this.redis.set(NEXT_KEY, String(due));
    await this.backups.cleanupIncoming(now);
    if (now < due) return false;
    await this.redis.set(NEXT_KEY, String(nextRun({ kind: 'daily', time: s.time }, s.timezone, now)));
    await this.backups.request().catch(() => undefined); // already running: fine
    return true;
  }

  /** After the schedule changes. */
  async reset(): Promise<void> {
    await this.redis.del(NEXT_KEY);
  }
}

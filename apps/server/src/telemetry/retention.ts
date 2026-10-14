import { type DynamicModule, Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { device, deviceProfile } from '../db/schema';
import { JobRegistry } from '../scheduler/job-registry';

const DAY_MS = 86_400_000;
/**
 * The daily summary is refreshed over the last 3 days; raw data younger than that must stay, or a
 * refresh would recompute those days from what is left.
 */
export const MIN_RETENTION_DAYS = 4;

/** The oldest raw reading a profile keeps (minute, hourly and daily summaries are kept for good). */
export const retentionCutoff = (retentionDays: number, now = Date.now()) => now - Math.max(retentionDays, MIN_RETENTION_DAYS) * DAY_MS;

/** Deletes raw telemetry older than each profile's retention (spec §4.1 `retention_days`). */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(@Inject(DB) private readonly db: DB) {}

  /** Returns how many readings were deleted. One device at a time keeps each delete small. */
  async run(now = Date.now()): Promise<number> {
    let deleted = 0;
    const profiles = await this.db.select({ id: deviceProfile.id, retentionDays: deviceProfile.retentionDays }).from(deviceProfile);
    for (const p of profiles) {
      const cutoff = new Date(retentionCutoff(p.retentionDays, now));
      const devices = await this.db.select({ id: device.id }).from(device).where(eq(device.profileId, p.id));
      for (const d of devices) {
        const res = await this.db.execute(sql`DELETE FROM telemetry WHERE device_id = ${d.id} AND ts < ${cutoff}`);
        deleted += res.rowCount ?? 0;
      }
    }
    if (deleted) this.logger.log(`Retention: deleted ${deleted} readings`);
    return deleted;
  }
}

@Injectable()
class RetentionJob implements OnApplicationBootstrap {
  constructor(
    private readonly retention: RetentionService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_RETENTION') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('telemetry-retention', 6 * 3_600_000, () => this.retention.run().then(() => undefined));
  }
}

@Module({})
export class RetentionModule {
  static forRoot(opts: { scheduler: boolean }): DynamicModule {
    return {
      module: RetentionModule,
      providers: [RetentionService, RetentionJob, { provide: 'SCHEDULE_RETENTION', useValue: opts.scheduler }],
      exports: [RetentionService],
    };
  }
}

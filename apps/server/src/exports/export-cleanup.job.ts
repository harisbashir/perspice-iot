import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JobRegistry } from '../scheduler/job-registry';
import { ExportsService } from './exports.service';

/** Hourly: removes export files (and their jobs) once their 24 h download window has passed. */
@Injectable()
export class ExportCleanupJob implements OnApplicationBootstrap {
  constructor(
    private readonly exports: ExportsService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_EXPORT_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('export-cleanup', 3_600_000, () => this.run().then(() => undefined));
  }

  run(now = new Date()): Promise<number> {
    return this.exports.cleanup(now);
  }
}

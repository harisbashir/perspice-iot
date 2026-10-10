import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ExportCleanupJob } from './export-cleanup.job';
import { ExportProcessor } from './export.processor';
import { ExportSources } from './export-sources';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Global()
@Module({})
export class ExportsModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: ExportsModule,
      controllers: opts.api ? [ExportsController] : [],
      providers: [
        ExportSources,
        ExportsService,
        ExportCleanupJob,
        { provide: 'SCHEDULE_EXPORT_JOBS', useValue: opts.scheduler },
        ...(opts.scheduler ? [ExportProcessor] : []),
      ],
      exports: [ExportsService],
    };
  }
}

import { Global, Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { DashboardsController } from './dashboards.controller';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { InstancesService } from './instances.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Global()
@Module({
  imports: [TelemetryModule],
  controllers: [TemplatesController, DashboardsController, DataController],
  providers: [TemplatesService, InstancesService, DataService],
  exports: [TemplatesService, InstancesService, DataService],
})
export class DashboardsModule {}

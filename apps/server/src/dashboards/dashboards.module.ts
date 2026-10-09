import { Global, Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { InstancesService } from './instances.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Global()
@Module({
  controllers: [TemplatesController, DashboardsController],
  providers: [TemplatesService, InstancesService],
  exports: [TemplatesService, InstancesService],
})
export class DashboardsModule {}

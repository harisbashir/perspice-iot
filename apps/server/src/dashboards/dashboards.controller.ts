import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { DashboardDefinitionSchema } from '@perspice/shared';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { InstancesService } from './instances.service';

@Controller()
export class DashboardsController {
  constructor(private readonly instances: InstancesService) {}

  @Get('dashboards/device/:deviceId')
  @Require('device.read')
  async device(@CurrentUser() actor: AuthUser, @Param('deviceId') deviceId: string) {
    return (await this.instances.forDevice(actor, deviceId)) ?? { dashboard: null };
  }

  @Get('dashboards/asset/:assetId')
  @Require('asset.read')
  async asset(@CurrentUser() actor: AuthUser, @Param('assetId') assetId: string) {
    return (await this.instances.forAsset(actor, assetId)) ?? { dashboard: null };
  }

  @Get('dashboards/overview')
  async overview(@CurrentUser() actor: AuthUser) {
    return (await this.instances.overview(actor)) ?? { dashboard: null };
  }

  @Put('dashboard-instances/:id/override')
  @Require('dashboard.customize')
  @Audited('dashboard_instance.customise', 'dashboard_instance', { targetIdFrom: 'param' })
  customise(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    const { definition } = z.object({ definition: DashboardDefinitionSchema }).parse(raw);
    return this.instances.customise(actor, id, definition);
  }

  @Delete('dashboard-instances/:id/override')
  @Require('dashboard.customize')
  @Audited('dashboard_instance.resync', 'dashboard_instance', { targetIdFrom: 'param' })
  resync(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.instances.resync(actor, id);
  }
}

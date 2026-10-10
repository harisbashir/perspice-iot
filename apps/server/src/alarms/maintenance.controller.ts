import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { MaintenanceService } from './maintenance.service';

@Controller('devices/:id')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** Total run hours of a runtime key, and since the last service. */
  @Get('run-hours')
  @Require('telemetry.read')
  runHours(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() query: unknown) {
    return this.maintenance.runHours(actor, id, query);
  }

  @Get('services')
  @Require('device.read')
  list(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.list(actor, id);
  }

  /** Logs a service: maintenance reminders for the device start counting again. */
  @Post('services')
  @Require('device.service')
  @Audited('device.service', 'device', { targetIdFrom: 'param' })
  log(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.maintenance.log(actor, id, body);
  }
}

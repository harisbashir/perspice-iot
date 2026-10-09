import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { SchedulesService } from './schedules.service';

@Controller('report-schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @Require('report.schedule')
  list(@CurrentUser() actor: AuthUser) {
    return this.schedules.list(actor);
  }

  @Post()
  @Require('report.schedule', 'export.data')
  @Audited('report_schedule.create', 'report_schedule')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.schedules.create(actor, body);
  }

  @Put(':id')
  @Require('report.schedule', 'export.data')
  @Audited('report_schedule.update', 'report_schedule', { targetIdFrom: 'param' })
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.update(actor, id, body);
  }

  @Delete(':id')
  @Require('report.schedule')
  @HttpCode(204)
  @Audited('report_schedule.delete', 'report_schedule', { targetIdFrom: 'param' })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.schedules.remove(actor, id);
  }

  @Post(':id/run')
  @Require('report.schedule', 'export.data')
  @HttpCode(202)
  run(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.schedules.runNow(actor, id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { AlarmRulesService } from './rules.service';

const ListQuery = z.object({
  profileId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

@Controller()
export class AlarmRulesController {
  constructor(private readonly rules: AlarmRulesService) {}

  @Get('alarm-rules')
  @Require('alarm.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.rules.list(actor, ListQuery.parse(raw));
  }

  @Post('alarm-rules')
  @Require('alarm.rule.write')
  @Audited('alarm_rule.create', 'alarm_rule')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.rules.create(actor, body);
  }

  @Get('alarm-rules/:id')
  @Require('alarm.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.rules.get(actor, id);
  }

  @Put('alarm-rules/:id')
  @Require('alarm.rule.write')
  @Audited('alarm_rule.update', 'alarm_rule', { targetIdFrom: 'param' })
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.rules.update(actor, id, body);
  }

  @Delete('alarm-rules/:id')
  @Require('alarm.rule.write')
  @HttpCode(204)
  @Audited('alarm_rule.delete', 'alarm_rule', { targetIdFrom: 'param' })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.rules.remove(actor, id);
  }

  @Get('devices/:id/alarm-rules/effective')
  @Require('alarm.read')
  effective(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.rules.effective(actor, id);
  }
}

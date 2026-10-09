import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ALARM_SEVERITIES, ALARM_STATUSES } from '@perspice/shared';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { AlarmsService } from './alarms.service';

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item).optional());

const ListQuery = z.object({
  status: csv(z.enum(ALARM_STATUSES)),
  severity: csv(z.enum(ALARM_SEVERITIES)),
  deviceId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const Note = z.object({ comment: z.string().trim().max(2000).optional() }).default({});
const Comment = z.object({ comment: z.string().trim().min(1).max(2000) });

@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Get()
  @Require('alarm.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    const { cursor, limit, ...filter } = ListQuery.parse(raw);
    return this.alarms.list(actor, filter, cursor, limit);
  }

  @Get('summary')
  @Require('alarm.read')
  summary(@CurrentUser() actor: AuthUser) {
    return this.alarms.summary(actor);
  }

  @Get(':id')
  @Require('alarm.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.alarms.get(actor, id);
  }

  @Post(':id/ack')
  @Require('alarm.ack')
  @Audited('alarm.acknowledge', 'alarm', { targetIdFrom: 'param' })
  ack(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.alarms.acknowledge(actor, id, Note.parse(body).comment);
  }

  @Post(':id/clear')
  @Require('alarm.ack')
  @Audited('alarm.clear', 'alarm', { targetIdFrom: 'param' })
  clear(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.alarms.clear(actor, id, Note.parse(body).comment);
  }

  @Post(':id/comments')
  @Require('alarm.ack')
  comment(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.alarms.comment(actor, id, Comment.parse(body).comment);
  }
}

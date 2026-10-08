import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { CommandsService } from './commands.service';

const SendBody = z.object({
  name: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
  persistUntilOnline: z.boolean().optional(),
  ttlS: z.number().int().min(1).max(86400).optional(),
});

@Controller()
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Post('devices/:id/commands')
  @Require('device.command')
  @Audited('device.command', 'device', { targetIdFrom: 'param' })
  send(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.commands.send(actor, id, SendBody.parse(raw));
  }

  @Get('devices/:id/commands')
  @Require('device.read')
  list(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.commands.list(actor, id, Math.min(Math.max(Number(limit) || 50, 1), 500));
  }

  @Get('commands/:id')
  @Require('device.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.commands.get(actor, id);
  }
}

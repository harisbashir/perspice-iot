import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { DevicesService } from './devices.service';

const Tags = z.array(z.string().trim().min(1).max(50)).max(50);
const Timeout = z.number().int().min(10).max(365 * 86400).nullable();

const CreateDevice = z.object({
  name: z.string().trim().min(1).max(200),
  profileId: z.string().uuid(),
  customerId: z.string().uuid().nullish(),
  groupId: z.string().uuid().nullish(),
  tags: Tags.optional(),
  offlineTimeoutS: Timeout.optional(),
  deadTimeoutS: Timeout.optional(),
});

const UpdateDevice = CreateDevice.partial().extend({ disabled: z.boolean().optional() }).strict();

const ListQuery = z.object({
  search: z.string().max(200).optional(),
  profileId: z.string().uuid().optional(),
  status: z.enum(['never', 'online', 'offline', 'dead']).optional(),
  customerId: z.string().uuid().optional(),
  tag: z.string().max(50).optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const Attributes = z.record(z.unknown());

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @Require('device.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.devices.list(actor, ListQuery.parse(raw));
  }

  @Get(':id')
  @Require('device.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.get(actor, id);
  }

  @Post()
  @Require('device.write')
  @Audited('device.create', 'device')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.devices.create(actor, CreateDevice.parse(raw));
  }

  @Patch(':id')
  @Require('device.write')
  @Audited('device.update', 'device')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.update(actor, id, UpdateDevice.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('device.write')
  @Audited('device.delete', 'device')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.devices.remove(actor, id);
  }

  @Post(':id/credentials/regenerate')
  @Require('device.credentials')
  @Audited('device.credentials_regenerate', 'device')
  regenerate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.regenerateCredentials(actor, id);
  }

  @Put(':id/attributes/server')
  @Require('device.write')
  @Audited('device.attributes_server', 'device')
  setServer(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.setAttributes(actor, id, 'server', Attributes.parse(raw));
  }

  @Put(':id/attributes/shared')
  @Require('device.write')
  @Audited('device.attributes_shared', 'device')
  setShared(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.setAttributes(actor, id, 'shared', Attributes.parse(raw));
  }

  @Get(':id/debug')
  @Require('device.read')
  debug(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.debugLog(actor, id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { GeofenceListQuery, GeofencesService } from './geofences.service';

@Controller('geofences')
export class GeofencesController {
  constructor(private readonly geofences: GeofencesService) {}

  @Get()
  @Require('device.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.geofences.list(actor, GeofenceListQuery.parse(raw));
  }

  @Get(':id')
  @Require('device.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.geofences.get(actor, id);
  }

  @Post()
  @Require('geofence.manage')
  @Audited('geofence.create', 'geofence')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.geofences.create(actor, raw);
  }

  @Patch(':id')
  @Require('geofence.manage')
  @Audited('geofence.update', 'geofence')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.geofences.update(actor, id, raw);
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('geofence.manage')
  @Audited('geofence.delete', 'geofence')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.geofences.remove(actor, id);
  }
}

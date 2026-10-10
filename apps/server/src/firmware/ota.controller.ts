import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { DevicesService } from '../devices/devices.service';
import { Require } from '../rbac/require.decorator';
import { OtaService } from './ota.service';

@Controller()
export class OtaController {
  constructor(
    private readonly ota: OtaService,
    private readonly devices: DevicesService,
  ) {}

  @Post('ota-jobs')
  @Require('firmware.manage')
  @Audited('ota.create', 'ota_job')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.ota.create(actor, raw);
  }

  @Get('ota-jobs')
  @Require('firmware.manage')
  list(@Query() raw: unknown) {
    return this.ota.list(z.object({ firmwareId: z.string().uuid().optional() }).parse(raw).firmwareId);
  }

  @Get('ota-jobs/:id')
  @Require('firmware.manage')
  get(@Param('id') id: string) {
    return this.ota.get(id);
  }

  @Get('ota-jobs/:id/devices')
  @Require('firmware.manage')
  devicesOf(@Param('id') id: string) {
    return this.ota.devices(id);
  }

  @Post('ota-jobs/:id/cancel')
  @HttpCode(200)
  @Require('firmware.manage')
  @Audited('ota.cancel', 'ota_job')
  cancel(@Param('id') id: string) {
    return this.ota.cancel(id);
  }

  /** A device's updates, for anyone who can see the device. */
  @Get('devices/:id/ota')
  @Require('device.read')
  async forDevice(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.ota.forDevice((await this.devices.find(actor, id)).id);
  }
}

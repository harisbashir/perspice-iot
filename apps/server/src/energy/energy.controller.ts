import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { EnergyService } from './energy.service';
import { TariffService } from './tariff.service';

@Controller()
export class EnergyController {
  constructor(
    private readonly energy: EnergyService,
    private readonly tariffs: TariffService,
  ) {}

  /** Consumption and cost per hour/day/week/month of a per-interval key. */
  @Get('devices/:id/energy')
  @Require('telemetry.read')
  forDevice(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() query: unknown) {
    return this.energy.forDevice(actor, id, query);
  }

  /** The tariff that applies: the customer's own or the platform default (`customerId` for platform users). */
  @Get('tariff')
  @Require('telemetry.read')
  async get(@CurrentUser() actor: AuthUser, @Query('customerId') customerId?: string) {
    return { tariff: await this.tariffs.get(actor, customerId) };
  }

  @Put('tariff')
  @Require('tariff.manage')
  @Audited('tariff.update', 'tariff')
  put(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.tariffs.put(actor, body);
  }

  @Delete('tariff')
  @HttpCode(204)
  @Require('tariff.manage')
  @Audited('tariff.delete', 'tariff')
  async remove(@CurrentUser() actor: AuthUser, @Query('customerId') customerId?: string) {
    await this.tariffs.remove(actor, customerId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { DevicesService } from '../devices/devices.service';
import { Require } from '../rbac/require.decorator';
import { LocationService } from './location.service';
import { TripsService } from './trips.service';

const DAY = 86_400_000;

const FixedLocation = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  alt: z.number().min(-1000).max(100_000).optional(),
});

/** `from`/`to` in ms; defaults to the `defaultSpan` before now; at most a year. */
const RangeQuery = (defaultSpan: number) =>
  z
    .object({ from: z.coerce.number().int().optional(), to: z.coerce.number().int().optional() })
    .transform((q) => {
      const to = q.to ?? Date.now();
      return { to, from: q.from ?? to - defaultSpan };
    })
    .refine((q) => q.from < q.to, { message: '`from` must be before `to`', path: ['from'] })
    .refine((q) => q.to - q.from <= 366 * DAY, { message: 'Range must be at most a year', path: ['from'] });
const RouteQuery = RangeQuery(DAY);

@Controller('devices/:id')
export class LocationController {
  constructor(
    private readonly devices: DevicesService,
    private readonly location: LocationService,
    private readonly trips: TripsService,
  ) {}

  @Get('location')
  @Require('device.read')
  async get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.devices.find(actor, id);
    return { location: await this.location.current(id) };
  }

  @Put('location')
  @Require('device.write')
  @Audited('device.location_set', 'device')
  async set(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    const d = await this.devices.find(actor, id);
    return { location: await this.location.setFixed(d.id, d.profileId, FixedLocation.parse(raw)) };
  }

  @Delete('location')
  @HttpCode(204)
  @Require('device.write')
  @Audited('device.location_cleared', 'device')
  async clear(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.location.clear((await this.devices.find(actor, id)).id);
  }

  @Get('trips')
  @Require('telemetry.read')
  async listTrips(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() raw: unknown) {
    const d = await this.devices.find(actor, id);
    const q = RangeQuery(30 * DAY).parse(raw);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(raw);
    return this.trips.list(d.id, q.from, q.to, limit);
  }

  @Get('distance')
  @Require('telemetry.read')
  async distance(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() raw: unknown) {
    const d = await this.devices.find(actor, id);
    const q = RangeQuery(30 * DAY).parse(raw);
    return this.trips.distancePerDay(d.id, d.profileId, q.from, q.to);
  }

  @Get('route')
  @Require('telemetry.read')
  async route(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() raw: unknown) {
    const d = await this.devices.find(actor, id);
    const q = RouteQuery.parse(raw);
    return this.location.route(d.id, d.profileId, q.from, q.to);
  }
}

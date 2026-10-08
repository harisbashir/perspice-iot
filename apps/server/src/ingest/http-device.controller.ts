import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { device } from '../db/schema';
import { DeviceTokenGuard } from './device-token.guard';
import { MessageRouter } from './message-router';

/** Device-facing HTTP transport (spec §5.2) for devices that cannot hold an MQTT connection. */
@Controller('v1/device')
@Public()
@UseGuards(DeviceTokenGuard)
export class HttpDeviceController {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly router: MessageRouter,
  ) {}

  @Post('telemetry')
  @HttpCode(202)
  async telemetry(@Req() req: Request, @Body() body: unknown) {
    const deviceId = req.deviceId!;
    const meta = await this.router.deviceMeta(deviceId);
    if (!meta) throw notFound();
    const result = await this.router.handleTelemetry(deviceId, meta, Buffer.from(JSON.stringify(body ?? null)));
    if (!result.ok) throw validation({ reason: result.reason }, `Telemetry rejected: ${result.reason}`);
    return {};
  }

  @Post('attributes')
  @HttpCode(202)
  async attributes(@Req() req: Request, @Body() body: unknown) {
    const result = await this.router.handleAttributes(req.deviceId!, Buffer.from(JSON.stringify(body ?? null)));
    if (!result.ok) throw validation({ reason: result.reason }, `Attributes rejected: ${result.reason}`);
    return {};
  }

  @Get('config')
  async config(@Req() req: Request) {
    const row = await this.db.query.device.findFirst({
      where: eq(device.id, req.deviceId!),
      columns: { attributes: true },
    });
    if (!row) throw notFound();
    return row.attributes.shared;
  }
}

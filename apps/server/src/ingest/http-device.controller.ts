import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { CommandAck } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CommandsService } from '../commands/commands.service';
import { OtaService } from '../firmware/ota.service';
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
    private readonly commands: CommandsService,
    private readonly ota: OtaService,
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

  /** The firmware update to apply now; 204 when there is none. */
  @Get('ota')
  async otaUpdate(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const msg = await this.ota.messageFor(req.deviceId!);
    if (!msg) {
      res.status(204);
      return;
    }
    return msg;
  }

  @Post('ota/progress')
  @HttpCode(202)
  async otaProgress(@Req() req: Request, @Body() body: unknown) {
    if (!(await this.ota.progress(req.deviceId!, body))) throw validation([], 'No update in progress for this version');
    return {};
  }

  /** Long-poll for the next command (`wait` 0–30 s); 204 when none arrives. */
  @Get('commands')
  async nextCommand(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('wait') wait?: string) {
    const waitS = z.coerce.number().int().min(0).max(30).catch(0).parse(wait ?? 0);
    const cmd = await this.commands.nextForHttp(req.deviceId!, waitS);
    if (!cmd) {
      res.status(204);
      return;
    }
    return { cid: cmd.id, name: cmd.name, params: cmd.params };
  }

  @Post('commands/:cid/ack')
  @HttpCode(202)
  async ack(@Req() req: Request, @Param('cid') cid: string, @Body() body: unknown) {
    const ack = CommandAck.parse({ ...(body as object), cid });
    await this.commands.handleAck(req.deviceId!, ack);
    return {};
  }
}

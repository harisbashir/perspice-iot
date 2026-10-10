import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { FirmwareService } from './firmware.service';

@Controller('firmware')
export class FirmwareController {
  constructor(private readonly firmware: FirmwareService) {}

  @Get()
  @Require('firmware.manage')
  list(@Query() raw: unknown) {
    const { profileId } = z.object({ profileId: z.string().uuid().optional() }).parse(raw);
    return this.firmware.list(profileId);
  }

  /** The image as the raw body (application/octet-stream); `profileId`, `version`, `notes` in the query. */
  @Post()
  @Require('firmware.manage')
  @Audited('firmware.upload', 'firmware')
  upload(@CurrentUser() actor: AuthUser, @Query() query: unknown, @Req() req: Request) {
    return this.firmware.upload(actor, query, req);
  }

  @Get(':id/download')
  @Require('firmware.manage')
  async download(@Param('id') id: string) {
    return { url: await this.firmware.downloadUrl(id) };
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('firmware.manage')
  @Audited('firmware.delete', 'firmware')
  async remove(@Param('id') id: string) {
    await this.firmware.remove(id);
  }
}

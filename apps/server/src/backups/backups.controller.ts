import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Audited } from '../audit/audited.decorator';
import { notFound } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { BackupScheduleJob } from './backup.schedule';
import { BackupService } from './backup.service';
import { RestoreService } from './restore.service';

@Controller('system')
export class BackupsController {
  constructor(
    private readonly backups: BackupService,
    private readonly schedule: BackupScheduleJob,
    private readonly restores: RestoreService,
  ) {}

  @Get('backups')
  @Require('backup.manage')
  status() {
    return this.backups.status();
  }

  @Post('backups')
  @Require('backup.manage')
  @HttpCode(202)
  @Audited('backup.start', 'backup')
  start() {
    return this.backups.request();
  }

  /** A 5-minute link to the latest backup file. */
  @Get('backups/latest/download')
  @Require('backup.manage')
  @Audited('backup.download', 'backup')
  async download() {
    const url = await this.backups.downloadUrl();
    if (!url) throw notFound('There is no backup yet');
    return { url };
  }

  @Put('backups/schedule')
  @Require('backup.manage')
  @Audited('backup.schedule', 'backup')
  async setSchedule(@Body() body: unknown) {
    const status = await this.backups.setSchedule(body);
    await this.schedule.reset();
    return status;
  }

  /** Upload a backup file (raw body, application/octet-stream) to restore it. */
  @Post('restore')
  @Require('backup.manage')
  @HttpCode(202)
  @Audited('backup.restore', 'backup')
  restore(@Req() req: Request) {
    return this.restores.start(req);
  }

  @Get('restore')
  @Require('backup.manage')
  restoreStatus() {
    return this.restores.status();
  }
}

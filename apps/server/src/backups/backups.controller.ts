import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { notFound } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { BackupScheduleJob } from './backup.schedule';
import { BackupService } from './backup.service';

@Controller('system/backups')
export class BackupsController {
  constructor(
    private readonly backups: BackupService,
    private readonly schedule: BackupScheduleJob,
  ) {}

  @Get()
  @Require('backup.manage')
  status() {
    return this.backups.status();
  }

  @Post()
  @Require('backup.manage')
  @HttpCode(202)
  @Audited('backup.start', 'backup')
  start() {
    return this.backups.request();
  }

  /** A 5-minute link to the latest backup file. */
  @Get('latest/download')
  @Require('backup.manage')
  @Audited('backup.download', 'backup')
  async download() {
    const url = await this.backups.downloadUrl();
    if (!url) throw notFound('There is no backup yet');
    return { url };
  }

  @Put('schedule')
  @Require('backup.manage')
  @Audited('backup.schedule', 'backup')
  async setSchedule(@Body() body: unknown) {
    const status = await this.backups.setSchedule(body);
    await this.schedule.reset();
    return status;
  }
}

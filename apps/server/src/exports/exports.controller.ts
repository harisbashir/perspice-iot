import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { ExportsService } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exportJobs: ExportsService) {}

  /** 200 with the file for up to 50,000 rows; 202 with a background job above that. */
  @Post()
  @Require('export.data')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Res() res: Response): Promise<void> {
    await this.exportJobs.export(user, body, res);
  }

  @Get()
  @Require('export.data')
  list(@CurrentUser() user: AuthUser) {
    return this.exportJobs.list(user);
  }

  @Get(':id')
  @Require('export.data')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exportJobs.get(user, id);
  }
}

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Queues a PDF of a dashboard; the result arrives like a background export. */
  @Post('reports/dashboard')
  @Require('export.data')
  @HttpCode(202)
  request(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.reports.request(user, body);
  }

  /** Used by the renderer's print page: authorised by a single-use render token, not a session. */
  @Public()
  @Post('print/session')
  @HttpCode(200)
  session(@Body() body: unknown) {
    return this.reports.openSession(body);
  }

  @Public()
  @Post('print/data')
  @HttpCode(200)
  data(@Body() body: unknown) {
    return this.reports.printData(body);
  }
}

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DataQuerySchema } from '@perspice/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { DataService } from './data.service';

@Controller('dashboards')
export class DataController {
  constructor(private readonly data: DataService) {}

  /** One request per dashboard render: every widget's data, each resolved within the viewer's scope. */
  @Post('data')
  @HttpCode(200)
  async query(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const q = DataQuerySchema.parse(raw);
    return { results: await this.data.query(actor, q.deviceId, q.requests, q.assetId) };
  }
}

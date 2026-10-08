import { Public } from '../auth/decorators';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CONFIG, type Config } from '../config/config';
import { HealthRegistry } from './health.registry';
import { appVersion } from './version';

@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly registry: HealthRegistry,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', role: this.config.PERSPICE_ROLE, version: appVersion() };
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    const { ok, failing } = await this.registry.run();
    res.status(ok ? 200 : 503).json(ok ? { status: 'ok' } : { status: 'unavailable', failing });
  }
}

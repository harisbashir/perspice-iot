import { Controller, Get, Inject, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { CONFIG, type Config } from '../config/config';
import { MetricsService } from './metrics.service';

/** Prometheus scrape endpoint. Outside the /api prefix, so Caddy never exposes it. */
@Public()
@Controller()
export class MetricsController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  async scrape(@Res() res: Response) {
    if (!this.config.METRICS_ENABLED) throw new NotFoundException();
    const { contentType, body } = await this.metrics.text();
    res.type(contentType).send(body);
  }
}

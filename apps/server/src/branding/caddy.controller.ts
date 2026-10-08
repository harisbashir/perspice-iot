import { Controller, Get, HttpCode, Inject, Query } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { TenantHostResolver } from '../auth/tenant-host.middleware';
import { notFound } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';

/**
 * Caddy's on-demand TLS "ask" endpoint: only issue certificates for hosts we serve.
 * Reachable only on the internal network (Caddy returns 404 for /internal/* from outside).
 */
@Controller('internal/caddy')
@Public()
export class CaddyController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly resolver: TenantHostResolver,
  ) {}

  @Get('ask')
  @HttpCode(200)
  async ask(@Query('domain') domain?: string) {
    const host = (domain ?? '').toLowerCase();
    if (host === `mqtt.${this.config.BASE_DOMAIN.toLowerCase()}`) return { ok: true };
    const resolved = host ? await this.resolver.resolve(host) : { kind: 'unknown' as const };
    // Bare IPs and "localhost" resolve to platform for logins, but never get certificates.
    if (resolved.kind === 'customer' || (resolved.kind === 'platform' && host === this.config.BASE_DOMAIN.toLowerCase())) {
      return { ok: true };
    }
    throw notFound();
  }
}

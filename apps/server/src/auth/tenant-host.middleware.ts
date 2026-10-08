import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';
import { isIP } from 'node:net';
import { REDIS } from '../common/redis.module';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { customer } from '../db/schema';
import type { TenantHost } from './auth.types';

const CACHE_TTL_S = 60;

export const tenantCacheKey = (slug: string) => `tenant:${slug}`;

@Injectable()
export class TenantHostResolver {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** `BASE_DOMAIN`, `localhost` and bare IPs → platform; `{slug}.{BASE_DOMAIN}` → active customer. */
  async resolve(hostHeader: string | undefined): Promise<TenantHost> {
    const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const base = this.config.BASE_DOMAIN.toLowerCase();
    if (host === base || host === 'localhost' || isIP(host)) return { kind: 'platform' };
    if (!host.endsWith(`.${base}`)) return { kind: 'unknown' };
    const slug = host.slice(0, -(base.length + 1));
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return { kind: 'unknown' };
    const customerId = await this.customerIdForSlug(slug);
    return customerId ? { kind: 'customer', customerId, slug } : { kind: 'unknown' };
  }

  private async customerIdForSlug(slug: string): Promise<string | null> {
    const cached = await this.redis.get(tenantCacheKey(slug));
    if (cached !== null) return cached || null;
    const row = await this.db.query.customer.findFirst({
      where: and(eq(customer.slug, slug), eq(customer.status, 'active')),
      columns: { id: true },
    });
    await this.redis.set(tenantCacheKey(slug), row?.id ?? '', 'EX', CACHE_TTL_S);
    return row?.id ?? null;
  }
}

@Injectable()
export class TenantHostMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantHostResolver) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      req.tenantHost = await this.resolver.resolve(req.headers.host);
      next();
    } catch (err) {
      next(err);
    }
  }
}

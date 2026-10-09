import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { ErrorCode } from '@perspice/shared';
import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';

const KEY = 'maintenance';
const CACHE_MS = 1000;

export interface MaintenanceState {
  since: number;
  reason: string;
}

/** Platform-wide maintenance mode (during restores), shared through Redis. */
@Injectable()
export class Maintenance {
  private cached: { at: number; state: MaintenanceState | null } = { at: 0, state: null };

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async begin(reason: string): Promise<void> {
    const state: MaintenanceState = { since: Date.now(), reason };
    // Expires on its own if the process running the restore dies.
    await this.redis.set(KEY, JSON.stringify(state), 'EX', 6 * 3600);
    this.cached = { at: Date.now(), state };
  }

  async end(): Promise<void> {
    await this.redis.del(KEY);
    this.cached = { at: Date.now(), state: null };
  }

  async state(fresh = false): Promise<MaintenanceState | null> {
    if (!fresh && Date.now() - this.cached.at < CACHE_MS) return this.cached.state;
    const raw = await this.redis.get(KEY);
    this.cached = { at: Date.now(), state: raw ? (JSON.parse(raw) as MaintenanceState) : null };
    return this.cached.state;
  }
}

/** While in maintenance, the API answers 503 except for health, sign-in refresh, branding and restore status. */
const ALLOWED = [/^\/(health|ready|metrics)$/, /^\/api\/auth\/(refresh|me|logout)$/, /^\/api\/public\//, /^\/api\/system\/restore$/];

@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly maintenance: Maintenance) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = req.originalUrl.split('?')[0]!;
    if (ALLOWED.some((r) => r.test(path))) return next();
    const state = await this.maintenance.state().catch(() => null);
    if (!state) return next();
    res.status(503).setHeader('retry-after', '30');
    res.json({ code: ErrorCode.MAINTENANCE, message: 'The platform is being restored from a backup. Please try again in a few minutes.', details: { since: state.since } });
  }
}

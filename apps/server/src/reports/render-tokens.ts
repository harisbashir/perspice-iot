import { Inject, Injectable } from '@nestjs/common';
import type { ReportRequest } from '@perspice/shared';
import type Redis from 'ioredis';
import { randomToken, sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import type { ActorSnapshot } from '../exports/exports.service';

/** What a render token (and the print session opened with it) may show: one dashboard, as one viewer. */
export interface RenderBinding {
  userId: string;
  actor: ActorSnapshot;
  request: ReportRequest;
}

export const RENDER_TOKEN_TTL_MS = 60_000;
export const PRINT_SESSION_TTL_MS = 120_000;

/**
 * Render tokens let the headless browser load one dashboard without a user session (Review
 * Focus 5): a token is single use and expires after 60 s. Redeeming it opens a print session
 * bound to the same dashboard and viewer, which the print page uses for its data requests.
 * Only hashes are stored in Redis.
 */
@Injectable()
export class RenderTokens {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(binding: RenderBinding, ttlMs = RENDER_TOKEN_TTL_MS): Promise<string> {
    const token = randomToken('rt_');
    await this.redis.set(`render:token:${sha256Hex(token)}`, JSON.stringify(binding), 'PX', ttlMs);
    return token;
  }

  /** Returns the binding once; any later (or late) attempt gets null. */
  async redeem(token: string): Promise<RenderBinding | null> {
    const raw = await this.redis.getdel(`render:token:${sha256Hex(token)}`);
    return raw ? (JSON.parse(raw) as RenderBinding) : null;
  }

  async openSession(binding: RenderBinding): Promise<string> {
    const session = randomToken('rs_');
    await this.redis.set(`render:session:${sha256Hex(session)}`, JSON.stringify(binding), 'PX', PRINT_SESSION_TTL_MS);
    return session;
  }

  async session(session: string): Promise<RenderBinding | null> {
    const raw = await this.redis.get(`render:session:${sha256Hex(session)}`);
    return raw ? (JSON.parse(raw) as RenderBinding) : null;
  }
}

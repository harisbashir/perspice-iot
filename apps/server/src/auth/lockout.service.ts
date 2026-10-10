import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';

export const MAX_FAILURES = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const FAILURE_WINDOW_S = 24 * 60 * 60;

/** 5 consecutive failures lock the account for 15 min, doubling per further lockout (max 24 h). */
@Injectable()
export class LockoutService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Records a failure; returns the lock expiry if this failure triggered a lockout. */
  async registerFailure(userId: string): Promise<Date | null> {
    const failKey = `lock:fail:${userId}`;
    const fails = await this.redis.incr(failKey);
    await this.redis.expire(failKey, FAILURE_WINDOW_S);
    if (fails < MAX_FAILURES) return null;

    const countKey = `lock:count:${userId}`;
    const lockouts = await this.redis.incr(countKey);
    await this.redis.expire(countKey, FAILURE_WINDOW_S);
    const ms = Math.min(BASE_LOCK_MS * 2 ** (lockouts - 1), MAX_LOCK_MS);
    const until = Date.now() + ms;
    await this.redis.multi().set(`lock:until:${userId}`, String(until), 'PX', ms).del(failKey).exec();
    return new Date(until);
  }

  async reset(userId: string): Promise<void> {
    await this.redis.del(`lock:fail:${userId}`, `lock:until:${userId}`, `lock:count:${userId}`);
  }

  async lockedUntil(userId: string): Promise<Date | null> {
    const until = Number(await this.redis.get(`lock:until:${userId}`));
    return until > Date.now() ? new Date(until) : null;
  }
}

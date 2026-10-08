import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../common/redis.module';

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
const RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;

/** Redis-based mutual exclusion across instances (`SET NX PX` with renewal). */
@Injectable()
export class LeaderLock {
  readonly instanceId = randomUUID();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Runs `fn` only if the lock is free; returns false when another instance holds it. */
  async run(name: string, ttlMs: number, fn: () => Promise<void>): Promise<boolean> {
    const key = `lock:${name}`;
    if (!(await this.redis.set(key, this.instanceId, 'PX', ttlMs, 'NX'))) return false;
    const renew = setInterval(() => {
      void this.redis.eval(RENEW, 1, key, this.instanceId, String(ttlMs)).catch(() => undefined);
    }, Math.max(100, Math.floor(ttlMs / 3)));
    try {
      await fn();
    } finally {
      clearInterval(renew);
      await this.redis.eval(RELEASE, 1, key, this.instanceId).catch(() => undefined);
    }
    return true;
  }

  /** Claims `name` for `ttlMs` without releasing it (at most once per window across instances). */
  async claim(name: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(`lock:${name}`, this.instanceId, 'PX', ttlMs, 'NX')) === 'OK';
  }
}

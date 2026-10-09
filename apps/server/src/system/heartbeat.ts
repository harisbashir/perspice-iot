import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { hostname } from 'node:os';
import { REDIS } from '../common/redis.module';
import { appVersion } from '../common/version';
import { CONFIG, type Config } from '../config/config';

export const HEARTBEAT_PREFIX = 'heartbeat:';
const EVERY_MS = 10_000;
const TTL_S = 30;

/** Each process announces itself in Redis every 10 s (gone 30 s after it stops), for the System page. */
@Injectable()
export class Heartbeat implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly instance = `${hostname()}-${process.pid}`;
  private readonly startedAt = Date.now();
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get key(): string {
    return `${HEARTBEAT_PREFIX}${this.config.PERSPICE_ROLE}:${this.instance}`;
  }

  async beat(): Promise<void> {
    const info = { role: this.config.PERSPICE_ROLE, instance: this.instance, version: appVersion(), startedAt: this.startedAt, lastSeen: Date.now() };
    await this.redis.set(this.key, JSON.stringify(info), 'EX', TTL_S);
  }

  onApplicationBootstrap(): void {
    void this.beat().catch(() => undefined);
    this.timer = setInterval(() => void this.beat().catch(() => undefined), EVERY_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.redis.del(this.key).catch(() => undefined);
  }
}

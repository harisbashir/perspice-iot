import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { REDIS } from '../src/common/redis.module';
import { type Config, type Role, loadConfig } from '../src/config/config';
import { DB } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrate';
import { configureHttpApp } from '../src/main';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request.agent>;
  db: DB;
  redis: Redis;
  config: Config;
  close(): Promise<void>;
}

export interface TestAppOptions {
  role?: Role;
  overrides?: Partial<Record<keyof Config, string>>;
  /** Reuse an existing test database (e.g. a second instance of the same deployment). */
  databaseUrl?: string;
  /** Extra controllers mounted for a test (e.g. to exercise a decorator). */
  controllers?: Type[];
}

// Each Vitest worker gets its own Redis logical DB so parallel files cannot collide.
const redisDbIndex = (Number(process.env.VITEST_POOL_ID ?? '1') % 15) + 1;
let openApps = 0;

async function withAdminClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: inject('pgAdminUrl') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<string> {
  const name = `perspice_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((c) => c.query(`CREATE DATABASE ${name}`));
  const url = new URL(inject('pgAdminUrl'));
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return url.toString();
}

export function testEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: `${inject('redisUrl')}/${redisDbIndex}`,
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123',
    MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    INTERNAL_SECRET: 'test-internal-secret',
    PUBLIC_URL: 'http://localhost',
    BASE_DOMAIN: 'localhost',
    LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
  };
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const ownsDatabase = !opts.databaseUrl;
  const databaseUrl = opts.databaseUrl ?? (await createTestDatabase());
  const config = loadConfig({
    ...testEnv(databaseUrl),
    PERSPICE_ROLE: opts.role ?? 'all',
    ...opts.overrides,
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: opts.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app);
  await app.init();

  const redis = app.get<Redis>(REDIS);
  if (openApps === 0) await redis.flushdb();
  openApps++;

  return {
    app,
    http: request.agent(app.getHttpServer()),
    db: app.get<DB>(DB),
    redis,
    config,
    async close() {
      openApps--;
      await app.close();
      if (ownsDatabase) {
        const name = new URL(databaseUrl).pathname.slice(1);
        await withAdminClient((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
      }
    },
  };
}

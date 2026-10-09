import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer, TestContainers, Wait } from 'testcontainers';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { REDIS } from '../src/common/redis.module';
import { type Config, type Role, loadConfig } from '../src/config/config';
import { DB } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrate';
import { MqttIngestClient } from '../src/ingest/mqtt-ingest.client';
import { configureHttpApp } from '../src/main';

export interface TestApp {
  app: INestApplication;
  /** Set when started with `emqx: true`: broker URL for test MQTT clients. */
  mqttUrl?: string;
  emqxContainer?: StartedTestContainer;
  http: ReturnType<typeof request.agent>;
  db: DB;
  redis: Redis;
  config: Config;
  /** Starts listening on a real port if needed (for socket clients) and returns the base URL. */
  baseUrl(): Promise<string>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  role?: Role;
  overrides?: Partial<Record<keyof Config, string>>;
  /** Reuse an existing test database (e.g. a second instance of the same deployment). */
  databaseUrl?: string;
  /** Extra controllers mounted for a test (e.g. to exercise a decorator). */
  controllers?: Type[];
  /** Start a dedicated EMQX broker wired to this app's auth/ACL hooks. */
  emqx?: boolean;
}

export const INGEST_PASSWORD = 'ingest-test-password';
const EMQX_API_KEY = 'perspice';
const EMQX_API_SECRET = 'test-emqx-api-secret';
const DEPLOY_EMQX = join(__dirname, '../../../deploy/emqx');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

interface BrokerPorts {
  api: number;
  mqtt: number;
  dashboard: number;
}

/**
 * Starts EMQX with the production config template, calling back to the API on `ports.api`.
 * The API must already be listening: EMQX opens its HTTP connection pools at boot and a pool
 * that fails then (through the Testcontainers host tunnel) never recovers.
 */
async function startEmqx(ports: BrokerPorts): Promise<StartedTestContainer> {
  const apiPort = ports.api;
  await TestContainers.exposeHostPorts(apiPort);
  return new GenericContainer('emqx/emqx:5.8.6')
    .withCopyFilesToContainer([
      { source: join(DEPLOY_EMQX, 'emqx.conf.tmpl'), target: '/opt/perspice/emqx.conf.tmpl' },
      { source: join(DEPLOY_EMQX, 'entrypoint.sh'), target: '/opt/perspice/entrypoint.sh', mode: 0o755 },
    ])
    .withEntrypoint(['/opt/perspice/entrypoint.sh'])
    .withEnvironment({
      PERSPICE_API_URL: `http://host.testcontainers.internal:${apiPort}`,
      INTERNAL_SECRET: 'test-internal-secret',
      PERSPICE_EMQX_API_KEY: EMQX_API_KEY,
      PERSPICE_EMQX_API_SECRET: EMQX_API_SECRET,
    })
    .withExposedPorts({ container: 1883, host: ports.mqtt }, { container: 18083, host: ports.dashboard })
    .withWaitStrategy(Wait.forLogMessage(/is running now/))
    .withStartupTimeout(120_000)
    .start();
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
    MQTT_INGEST_PASSWORD: INGEST_PASSWORD,
    EMQX_API_KEY,
    EMQX_API_SECRET,
    AUTH_RATE_LIMIT_PER_MIN: '1000',
  };
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const ownsDatabase = !opts.databaseUrl;
  const databaseUrl = opts.databaseUrl ?? (await createTestDatabase());
  const storageDir = mkdtempSync(join(tmpdir(), 'perspice-storage-'));
  const ports: BrokerPorts | undefined = opts.emqx
    ? { api: await freePort(), mqtt: await freePort(), dashboard: await freePort() }
    : undefined;
  const brokerEnv: { MQTT_URL?: string; EMQX_API_URL?: string; AWS_IOT_MQTT_URL?: string } = ports
    ? {
        MQTT_URL: `mqtt://localhost:${ports.mqtt}`,
        EMQX_API_URL: `http://localhost:${ports.dashboard}`,
        // In AWS IoT Core mode, the test broker stands in for the IoT endpoint.
        ...(opts.overrides?.MQTT_TRANSPORT === 'aws-iot' ? { AWS_IOT_MQTT_URL: `mqtt://perspice-ingest:${INGEST_PASSWORD}@localhost:${ports.mqtt}` } : {}),
      }
    : {};
  const config = loadConfig({
    ...testEnv(databaseUrl),
    ...brokerEnv,
    STORAGE_LOCAL_PATH: storageDir,
    PERSPICE_ROLE: opts.role ?? 'all',
    ...opts.overrides,
  });

  // Flush before the app starts: modules create Redis state (e.g. stream consumer groups) at init.
  if (openApps === 0) {
    const flusher = new Redis(config.REDIS_URL);
    await flusher.flushdb();
    await flusher.quit();
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: opts.controllers ?? [],
  }).compile();
  // PERSPICE_TEST_LOGS=1 shows server logs while debugging a test.
  const app = moduleRef.createNestApplication({
    logger: process.env.PERSPICE_TEST_LOGS ? ['error', 'warn', 'log'] : false,
  });
  configureHttpApp(app, config);
  await app.init();
  let emqx: StartedTestContainer | undefined;
  if (ports) {
    await app.listen(ports.api, '0.0.0.0');
    emqx = await startEmqx(ports);
    const ingest = app.get(MqttIngestClient, { strict: false });
    if (ingest) {
      // The client retries every second while the broker boots; wait for its subscriptions.
      await Promise.race([
        ingest.ready(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ingest client not ready after 60 s')), 60_000)),
      ]);
    }
  }

  const redis = app.get<Redis>(REDIS);
  openApps++;

  return {
    app,
    emqxContainer: emqx,
    mqttUrl: brokerEnv.MQTT_URL,
    http: request.agent(app.getHttpServer()),
    db: app.get<DB>(DB),
    redis,
    config,
    async baseUrl() {
      const server = app.getHttpServer();
      if (!server.listening) await app.listen(0, '127.0.0.1');
      return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    },
    async close() {
      openApps--;
      // Stop the broker first so its pooled connections don't hit a closed API port.
      await emqx?.stop();
      await app.close();
      rmSync(storageDir, { recursive: true, force: true });
      if (ownsDatabase) {
        const name = new URL(databaseUrl).pathname.slice(1);
        await withAdminClient((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
      }
    },
  };
}

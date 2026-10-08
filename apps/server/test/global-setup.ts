import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
    redisUrl: string;
    mailpitSmtp: { host: string; port: number };
    mailpitApiUrl: string;
  }
}

const started: StartedTestContainer[] = [];

/** Starts shared infrastructure once per test run; each TestApp gets its own database. */
export default async function setup(project: TestProject) {
  const [pg, redis, mailpit] = await Promise.all([
    new GenericContainer('timescale/timescaledb:2.17.2-pg16')
      .withEnvironment({ POSTGRES_PASSWORD: 'test' })
      .withCommand([
        'postgres',
        '-c', 'fsync=off',
        '-c', 'synchronous_commit=off',
        '-c', 'full_page_writes=off',
        '-c', 'max_connections=400',
        '-c', 'timescaledb.telemetry_level=off',
        '-c', 'timescaledb.max_background_workers=64',
        '-c', 'max_worker_processes=96',
      ])
      .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
    new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('axllent/mailpit:v1.21')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/api/v1/info', 8025))
      .start(),
  ]);
  started.push(pg, redis, mailpit);

  project.provide('pgAdminUrl', `postgres://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`);
  project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);
  project.provide('mailpitSmtp', { host: mailpit.getHost(), port: mailpit.getMappedPort(1025) });
  project.provide('mailpitApiUrl', `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);

  return async () => {
    await Promise.all(started.map((c) => c.stop()));
  };
}

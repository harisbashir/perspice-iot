import 'reflect-metadata';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { createServer } from 'node:http';
import { AppModule } from './app.module';
import { HealthRegistry } from './common/health.registry';
import { MetricsService } from './system/metrics.service';
import { ProblemFilter } from './common/problem.filter';
import { setupOpenApi } from './openapi';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { appVersion } from './common/version';
import { type Config, loadConfig } from './config/config';

export const API_PREFIX_EXCLUDE = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'ready', method: RequestMethod.GET },
  { path: 'metrics', method: RequestMethod.GET },
  { path: 'internal/*path', method: RequestMethod.ALL },
];

/** HTTP setup shared by `bootstrap` and the integration-test harness. */
export function configureHttpApp(app: INestApplication, config: Config): void {
  // Caddy terminates TLS on the same host/network; trust it for client IPs.
  (app as NestExpressApplication).set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(cookieParser());
  app.setGlobalPrefix('api', { exclude: API_PREFIX_EXCLUDE });
  app.useGlobalFilters(new ProblemFilter());
  app.useWebSocketAdapter(new RedisIoAdapter(app, config.REDIS_URL));
}

export async function bootstrap(config: Config = loadConfig(process.env)): Promise<void> {
  const role = config.PERSPICE_ROLE;

  if (role === 'api' || role === 'all') {
    const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureHttpApp(app, config);
    await setupOpenApi(app, config);
    app.enableShutdownHooks();
    await app.listen(config.PORT);
    return;
  }

  // Worker roles have no HTTP API; expose only /health, /ready and /metrics on the internal port.
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const registry = app.get(HealthRegistry);
  const metrics = app.get(MetricsService);
  createServer(async (req, res) => {
    if (req.url === '/metrics' && config.METRICS_ENABLED) {
      const { contentType, body } = await metrics.text();
      res.setHeader('content-type', contentType);
      res.end(body);
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ status: 'ok', role, version: appVersion() }));
    } else if (req.url === '/ready') {
      const { ok, failing } = await registry.run();
      res.statusCode = ok ? 200 : 503;
      res.end(JSON.stringify(ok ? { status: 'ok' } : { status: 'unavailable', failing }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }));
    }
  }).listen(config.PORT);
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { createServer } from 'node:http';
import { AppModule } from './app.module';
import { HealthRegistry } from './common/health.registry';
import { ProblemFilter } from './common/problem.filter';
import { appVersion } from './common/version';
import { type Config, loadConfig } from './config/config';

export const API_PREFIX_EXCLUDE = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'ready', method: RequestMethod.GET },
  { path: 'internal/*path', method: RequestMethod.ALL },
];

export async function bootstrap(config: Config = loadConfig(process.env)): Promise<void> {
  const role = config.PERSPICE_ROLE;

  if (role === 'api' || role === 'all') {
    const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api', { exclude: API_PREFIX_EXCLUDE });
    app.useGlobalFilters(new ProblemFilter());
    app.enableShutdownHooks();
    await app.listen(config.PORT);
    return;
  }

  // Worker roles have no HTTP API; expose only /health and /ready for container healthchecks.
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const registry = app.get(HealthRegistry);
  createServer(async (req, res) => {
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

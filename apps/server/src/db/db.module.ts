import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { HealthRegistry } from '../common/health.registry';
import { CONFIG, type Config } from '../config/config';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

const logger = new Logger('Database');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [CONFIG, HealthRegistry],
      useFactory: (config: Config, health: HealthRegistry) => {
        const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
        // Idle connections can be cut (database restart, restore swap); the pool replaces them.
        pool.on('error', (err) => logger.warn(`Database connection dropped: ${err.message}`));
        health.register('database', async () => {
          await pool.query('SELECT 1');
        });
        return pool;
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DB => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

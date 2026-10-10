import { resolve } from 'node:path';

/** pg_dump/pg_restore from the TimescaleDB image (see test/bin), for backup and restore tests. */
export const PG_TOOLS = { PG_DUMP_PATH: resolve(__dirname, 'bin/pg_dump'), PG_RESTORE_PATH: resolve(__dirname, 'bin/pg_restore') };

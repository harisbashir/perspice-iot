import type { RestoreStatusDto } from '@perspice/shared';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Pool } from 'pg';
import type { Config } from '../config/config';
import * as schema from '../db/schema';
import { createStorageDriver } from '../storage/storage.module';
import type { LatestBackup } from './backup.service';
import { MAINTENANCE_QUEUE } from './backup.service';

export interface BackupCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** For `--out -` / `restore -`. */
  stdout?: Writable;
  stdin?: Readable;
  /** Polling interval and give-up time (tests shorten them). */
  pollMs?: number;
  timeoutMs?: number;
}

/** Both commands hand the work to the scheduler's maintenance worker and wait for it. */
async function withQueue<T>(config: Config, fn: (q: Queue, redis: Redis) => Promise<T>): Promise<T> {
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const redis = new Redis(config.REDIS_URL);
  const q = new Queue(MAINTENANCE_QUEUE, { connection });
  try {
    return await fn(q, redis);
  } finally {
    await q.close();
    redis.disconnect();
    connection.disconnect();
  }
}

async function latestBackup(config: Config): Promise<LatestBackup | null> {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  try {
    const row = await drizzle(pool, { schema }).query.systemSetting.findFirst({ where: eq(schema.systemSetting.key, 'backup.latest') });
    return (row?.value as LatestBackup | undefined) ?? null;
  } finally {
    await pool.end();
  }
}

const NO_WORKER = 'Nothing picked the job up. Is the scheduler service running?';

/** `backup [--out <file>|-]`: runs a backup now and optionally copies it out. */
export async function cliBackup(config: Config, out: string | undefined, io: BackupCliIo): Promise<number> {
  const before = await latestBackup(config);
  const started = Date.now();
  const failed = await withQueue(config, async (q, redis) => {
    await q.add('backup', {}, { jobId: `backup-cli-${started}`, removeOnComplete: 100, removeOnFail: 100 });
    io.err('Backing up…');
    for (;;) {
      await new Promise((r) => setTimeout(r, io.pollMs ?? 1000));
      const latest = await latestBackup(config);
      if (latest && latest.createdAt !== before?.createdAt && latest.createdAt >= started - 1000) return null;
      const err = await redis.get('backup:last-error');
      if (err && (JSON.parse(err) as { at: number }).at >= started) return (JSON.parse(err) as { message: string }).message;
      if (Date.now() - started > (io.timeoutMs ?? 6 * 3_600_000)) return 'Timed out waiting for the backup';
      if (Date.now() - started > 60_000 && ((await q.getJobCounts('waiting')).waiting ?? 0) > 0 && !(await redis.exists('lock:backup'))) return NO_WORKER;
    }
  });
  if (failed) {
    io.err(`Backup failed: ${failed}`);
    return 1;
  }
  const latest = (await latestBackup(config))!;
  io.err(`Backup ${latest.file} (${latest.size} bytes, sha256 ${latest.sha256})`);
  if (out) {
    const body = (await createStorageDriver(config).getStream(latest.key)).body;
    await pipeline(body, out === '-' ? io.stdout! : createWriteStream(out, { mode: 0o600 }));
    if (out !== '-') io.out(out);
  }
  return 0;
}

/** `restore <file|->`: uploads a backup file and restores it (the platform goes into maintenance meanwhile). */
export async function cliRestore(config: Config, file: string | undefined, io: BackupCliIo): Promise<number> {
  if (!file) {
    io.err('Usage: restore <file> (or - to read the backup from standard input)');
    return 2;
  }
  const key = `restore/upload-${Date.now()}.pbk`;
  await createStorageDriver(config).putStream(key, file === '-' ? io.stdin! : createReadStream(file), 'application/octet-stream');
  const started = Date.now();
  const status = await withQueue(config, async (q, redis) => {
    const set = (s: RestoreStatusDto) => redis.set('restore:status', JSON.stringify(s));
    await set({ state: 'checking', message: 'Waiting to start', startedAt: started, finishedAt: null });
    await q.add('restore', { key }, { jobId: `restore-cli-${started}`, removeOnComplete: 100, removeOnFail: 100 });
    let last = '';
    for (;;) {
      await new Promise((r) => setTimeout(r, io.pollMs ?? 1000));
      const s = JSON.parse((await redis.get('restore:status')) ?? '{}') as RestoreStatusDto;
      if (s.message && s.message !== last) io.err(`${s.state}: ${s.message}`);
      last = s.message ?? '';
      if (s.state === 'done' || s.state === 'failed') return s;
      if (Date.now() - started > (io.timeoutMs ?? 6 * 3_600_000)) return { ...s, state: 'failed' as const, message: 'Timed out waiting for the restore' };
      if (Date.now() - started > 60_000 && s.message === 'Waiting to start') return { ...s, state: 'failed' as const, message: NO_WORKER };
    }
  });
  if (status.state !== 'done') {
    io.err(status.message ?? 'Restore failed');
    return 1;
  }
  io.out(status.message ?? 'Restored.');
  return 0;
}

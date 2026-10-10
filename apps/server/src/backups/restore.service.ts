import { Inject, Injectable, Logger } from '@nestjs/common';
import { type RestoreStatusDto, isCompatibleBackup } from '@perspice/shared';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { RULES_VERSION_KEY } from '../alarms/rules.service';
import { conflict } from '../common/app-error';
import { sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import { appVersion } from '../common/version';
import { CONFIG, type Config } from '../config/config';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import { seed } from '../db/seed';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { readBackupArchive } from './archive';
import { BACKUP_PREFIX, BackupService, type Manifest } from './backup.service';
import { Maintenance } from './maintenance';
import { restoreDatabase } from './pg-tools';

const STATUS_KEY = 'restore:status';
const UPLOAD_PREFIX = 'restore/';
/** Caches that would otherwise outlive the restored data. */
const STALE_KEYS = ['perm:*', 'devmeta:*', 'devtok:*', 'latest:*', 'groups:*', 'tenant:*', 'alarm:state:*', 'branding:*'];

class RestoreRefused extends Error {}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Restores a backup online (spec §10.2, Review Focus 3): the archive is decrypted and checked
 * first (wrong version, key or checksums refuse it before anything changes); then, in maintenance
 * mode, the dump goes into a side database that replaces the live one only once pg_restore has
 * succeeded; stored files are replaced; migrations run forward. Maintenance always ends.
 */
@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly backups: BackupService,
    private readonly maintenance: Maintenance,
  ) {}

  async status(): Promise<RestoreStatusDto> {
    const raw = await this.redis.get(STATUS_KEY);
    return raw ? (JSON.parse(raw) as RestoreStatusDto) : { state: 'idle', message: null, startedAt: null, finishedAt: null };
  }

  private async set(state: RestoreStatusDto['state'], message: string | null, startedAt: number | null): Promise<void> {
    const done = state === 'done' || state === 'failed';
    await this.redis.set(STATUS_KEY, JSON.stringify({ state, message, startedAt, finishedAt: done ? Date.now() : null } satisfies RestoreStatusDto));
  }

  /** Stores an uploaded backup and queues the restore. */
  async start(body: Readable): Promise<RestoreStatusDto> {
    const current = await this.status();
    if (current.state === 'checking' || current.state === 'restoring' || current.state === 'migrating') throw conflict('A restore is already running');
    if (!this.backups.configured) throw conflict('Restores need BACKUP_PASSPHRASE in the server configuration');
    const key = `${UPLOAD_PREFIX}upload-${Date.now()}.pbk`;
    await this.storage.putStream(key, body, 'application/octet-stream');
    await this.set('checking', 'Waiting to start', Date.now());
    await this.backups.queue.add('restore', { key }, { jobId: `restore-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
    return this.status();
  }

  /** Maintenance worker: restores the uploaded backup at `key` (deleted afterwards). */
  async run(key: string): Promise<void> {
    const startedAt = Date.now();
    const dir = await mkdtemp(join(tmpdir(), 'perspice-restore-'));
    let inMaintenance = false;
    try {
      await this.set('checking', 'Checking the backup', startedAt);
      const file = join(dir, 'backup.pbk');
      await pipeline((await this.storage.getStream(key)).body, createWriteStream(file));
      const out = join(dir, 'x');
      const manifest = await this.check(file, out);

      await this.set('restoring', 'Restoring the database', startedAt);
      await this.maintenance.begin('Restoring a backup');
      inMaintenance = true;
      await this.restoreDatabase(join(out, 'database.dump'));
      await this.set('restoring', 'Restoring files', startedAt);
      await this.restoreFiles(out, manifest);

      await this.set('migrating', 'Updating the database to this version', startedAt);
      await runMigrations(this.config.DATABASE_URL);
      const pool = new Pool({ connectionString: this.config.DATABASE_URL, max: 2 });
      try {
        await seed(drizzle(pool, { schema }));
      } finally {
        await pool.end();
      }
      await this.clearCaches();
      await this.set('done', `Restored the backup from ${new Date(manifest.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC (version ${manifest.version})`, startedAt);
    } catch (err) {
      const message = err instanceof RestoreRefused ? err.message : `Restore failed: ${(err as Error).message}`;
      this.logger.error(message);
      await this.set('failed', message, startedAt);
    } finally {
      if (inMaintenance) await this.maintenance.end();
      await rm(dir, { recursive: true, force: true });
      await this.storage.delete(key).catch(() => undefined);
    }
  }

  /** Decrypts, verifies checksums and compatibility. Nothing has changed yet when this throws. */
  private async check(file: string, out: string): Promise<Manifest> {
    let manifest: Manifest;
    try {
      const { files } = await readBackupArchive(file, this.config.BACKUP_PASSPHRASE!, out);
      if (!files.includes('manifest.json') || !files.includes('database.dump')) throw new Error('This file is not a complete backup');
      manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as Manifest;
      for (const f of manifest.files) {
        const digest = createHash('sha256');
        await pipeline(createReadStream(join(out, f.name)), digest);
        if (digest.digest('hex') !== f.sha256) throw new Error(`${f.name} does not match its checksum`);
      }
    } catch (err) {
      throw new RestoreRefused(`The backup can't be used: ${(err as Error).message}`);
    }
    const compat = isCompatibleBackup(manifest.version, appVersion());
    if (!compat.ok) throw new RestoreRefused(compat.reason);
    const fingerprint = sha256Hex(this.config.masterKey.toString('base64')).slice(0, 16);
    if (manifest.masterKeyFingerprint !== fingerprint) {
      throw new RestoreRefused(
        manifest.includesMasterKey
          ? 'The backup was made with a different MASTER_KEY. Set MASTER_KEY to the one inside the backup (config.env) and restart before restoring.'
          : 'The backup was made with a different MASTER_KEY, which this server needs to read the stored secrets. Set the original MASTER_KEY and restart before restoring.',
      );
    }
    return manifest;
  }

  /** Into a side database first; the live database is replaced only after pg_restore succeeded. */
  private async restoreDatabase(dump: string): Promise<void> {
    const live = new URL(this.config.DATABASE_URL);
    const name = decodeURIComponent(live.pathname.slice(1));
    const side = `${name}_restore`;
    const old = `${name}_before_restore`;
    const adminUrl = new URL(live);
    adminUrl.pathname = '/postgres';
    const sideUrl = new URL(live);
    sideUrl.pathname = `/${side}`;

    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${ident(side)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${ident(side)}`);
      try {
        const sideClient = new Client({ connectionString: sideUrl.toString() });
        await sideClient.connect();
        try {
          await sideClient.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
          await sideClient.query('SELECT timescaledb_pre_restore()');
        } finally {
          await sideClient.end();
        }
        await restoreDatabase(this.config, sideUrl.toString(), dump);
        const after = new Client({ connectionString: sideUrl.toString() });
        await after.connect();
        try {
          await after.query('SELECT timescaledb_post_restore()');
        } finally {
          await after.end();
        }
      } catch (err) {
        await admin.query(`DROP DATABASE IF EXISTS ${ident(side)} WITH (FORCE)`).catch(() => undefined);
        throw err;
      }
      // Swap: block new connections to the live database, end existing ones, rename both.
      await admin.query(`DROP DATABASE IF EXISTS ${ident(old)} WITH (FORCE)`);
      await admin.query(`ALTER DATABASE ${ident(name)} WITH ALLOW_CONNECTIONS false`);
      try {
        await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
        await admin.query(`ALTER DATABASE ${ident(name)} RENAME TO ${ident(old)}`);
      } catch (err) {
        await admin.query(`ALTER DATABASE ${ident(name)} WITH ALLOW_CONNECTIONS true`).catch(() => undefined);
        await admin.query(`DROP DATABASE IF EXISTS ${ident(side)} WITH (FORCE)`).catch(() => undefined);
        throw err;
      }
      await admin.query(`ALTER DATABASE ${ident(side)} RENAME TO ${ident(name)}`);
      await admin.query(`ALTER DATABASE ${ident(old)} WITH ALLOW_CONNECTIONS true`);
      await admin.query(`DROP DATABASE IF EXISTS ${ident(old)} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }

  /** Stored files become exactly the backup's (exports, backups and uploads are left alone). */
  private async restoreFiles(out: string, manifest: Manifest): Promise<void> {
    const wanted = new Map(manifest.files.filter((f) => f.name.startsWith('storage/')).map((f) => [f.name.slice('storage/'.length), f]));
    for (const key of await this.storage.list('')) {
      if (key.startsWith('exports/') || key.startsWith(BACKUP_PREFIX) || key.startsWith(UPLOAD_PREFIX)) continue;
      if (!wanted.has(key)) await this.storage.delete(key);
    }
    for (const [key, f] of wanted) {
      await this.storage.putStream(key, createReadStream(join(out, f.name)), f.contentType ?? 'application/octet-stream');
    }
  }

  private async clearCaches(): Promise<void> {
    for (const pattern of STALE_KEYS) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        if (keys.length) await this.redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    }
    await this.redis.incr(RULES_VERSION_KEY);
  }
}

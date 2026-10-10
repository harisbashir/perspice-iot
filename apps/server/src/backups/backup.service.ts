import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type BackupInfo, type BackupSchedule, BackupScheduleSchema, type BackupStatusDto } from '@perspice/shared';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { conflict, validation } from '../common/app-error';
import { sha256Hex } from '../common/crypto';
import { REDIS } from '../common/redis.module';
import { appVersion } from '../common/version';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { Dispatcher } from '../delivery/dispatcher';
import { RecipientResolver } from '../delivery/recipients';
import { nextRun } from '../schedules/next-run';
import { SettingsService } from '../settings/settings.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { readBackupArchive, writeBackupArchive } from './archive';
import { dumpDatabase } from './pg-tools';

export const MAINTENANCE_QUEUE = 'maintenance';
export const BACKUP_PREFIX = 'backups/';
const LOCK = 'lock:backup';
const LAST_ERROR = 'backup:last-error';

export interface Manifest {
  format: 1;
  version: string;
  createdAt: number;
  /** The newest applied migration, for restoring into the right schema. */
  migration: string | null;
  /** First 16 hex digits of sha256(MASTER_KEY): restores need the same key for stored secrets. */
  masterKeyFingerprint: string;
  includesMasterKey: boolean;
  files: { name: string; size: number; sha256: string; contentType?: string }[];
}

export interface LatestBackup extends BackupInfo {
  key: string;
}

/** Hashes what flows through (sha256 + byte count). */
function hashing(): { stream: Transform; digest: () => { sha256: string; size: number } } {
  const hash = createHash('sha256');
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _e, cb) {
      hash.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });
  return { stream, digest: () => ({ sha256: hash.digest('hex'), size }) };
}

/**
 * Backups (spec §10.2): database dump, storage files (not exports or backups) and a manifest,
 * encrypted with the operator's passphrase. Exactly one is kept: a new backup is written under a
 * temporary name, verified end to end, and only then replaces the previous one; a failed backup
 * leaves the previous one alone and alerts platform admins (Review Focus 1, 2).
 */
@Injectable()
export class BackupService implements OnApplicationShutdown {
  private readonly logger = new Logger(BackupService.name);
  readonly queue: Queue;
  private readonly connection: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly settings: SettingsService,
    private readonly dispatcher: Dispatcher,
    private readonly recipients: RecipientResolver,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
  }

  get configured(): boolean {
    return !!this.config.BACKUP_PASSPHRASE;
  }

  async schedule(): Promise<BackupSchedule> {
    return BackupScheduleSchema.parse((await this.settings.get('backup.schedule')) ?? {});
  }

  async setSchedule(body: unknown): Promise<BackupStatusDto> {
    await this.settings.set('backup.schedule', BackupScheduleSchema.parse(body));
    return this.status();
  }

  async latest(): Promise<LatestBackup | null> {
    return (await this.settings.get('backup.latest')) ?? null;
  }

  async status(): Promise<BackupStatusDto> {
    const [latest, schedule, running, lastError] = await Promise.all([this.latest(), this.schedule(), this.redis.exists(LOCK), this.redis.get(LAST_ERROR)]);
    return {
      latest: latest ? { file: latest.file, size: latest.size, sha256: latest.sha256, version: latest.version, createdAt: latest.createdAt } : null,
      running: running === 1,
      lastError: lastError ? (JSON.parse(lastError) as { at: number; message: string }) : null,
      schedule,
      nextRunAt: schedule.enabled ? nextRun({ kind: 'daily', time: schedule.time }, schedule.timezone, Date.now()) : null,
      configured: this.configured,
    };
  }

  /** Queues a backup (one at a time). */
  async request(): Promise<BackupStatusDto> {
    if (!this.configured) throw validation([], 'Backups need BACKUP_PASSPHRASE in the server configuration');
    if (await this.redis.exists(LOCK)) throw conflict('A backup is already running');
    await this.queue.add('backup', {}, { jobId: `backup-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
    return this.status();
  }

  /** Signed download link to the latest backup (5 minutes). */
  async downloadUrl(): Promise<string | null> {
    const latest = await this.latest();
    return latest ? this.storage.getSignedUrl(latest.key, 300) : null;
  }

  /** Runs a backup now (maintenance worker or tests). Resolves false when one is already running. */
  async run(now = Date.now()): Promise<boolean> {
    if (!this.configured) throw new Error('BACKUP_PASSPHRASE is not configured');
    const token = String(now) + Math.random();
    if (!(await this.redis.set(LOCK, token, 'PX', 6 * 3_600_000, 'NX'))) return false;
    const dir = await mkdtemp(join(tmpdir(), 'perspice-backup-'));
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
    const name = `perspice-backup-${appVersion()}-${stamp}.pbk`;
    const tmpKey = `${BACKUP_PREFIX}.incoming-${stamp}.pbk`;
    try {
      const manifest = await this.write(dir, tmpKey, now);
      const { sha256, size } = await this.verify(dir, tmpKey, manifest);
      const key = BACKUP_PREFIX + name;
      await this.storage.move(tmpKey, key);
      const previous = await this.latest();
      const info: LatestBackup = { key, file: name, size, sha256, version: manifest.version, createdAt: now };
      await this.settings.set('backup.latest', info);
      // Exactly one kept: the previous backup goes only once the new one is in place.
      if (previous && previous.key !== key) await this.storage.delete(previous.key).catch(() => undefined);
      await this.redis.del(LAST_ERROR);
      this.logger.log(`Backup ${name} written (${size} bytes)`);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Backup failed: ${message}`);
      await this.storage.delete(tmpKey).catch(() => undefined);
      await this.redis.set(LAST_ERROR, JSON.stringify({ at: Date.now(), message }));
      await this.alert(message);
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
      if ((await this.redis.get(LOCK)) === token) await this.redis.del(LOCK);
    }
  }

  /** Streams the archive to `tmpKey`; returns the manifest written into it. */
  private async write(dir: string, tmpKey: string, now: number): Promise<Manifest> {
    const dump = join(dir, 'database.dump');
    await dumpDatabase(this.config, dump);
    const files: Manifest['files'] = [];
    const out = new PassThrough();
    const stored = this.storage.putStream(tmpKey, out, 'application/octet-stream');
    const manifest: Manifest = {
      format: 1,
      version: appVersion(),
      createdAt: now,
      migration: await this.lastMigration(),
      masterKeyFingerprint: sha256Hex(this.config.masterKey.toString('base64')).slice(0, 16),
      includesMasterKey: this.config.BACKUP_INCLUDE_MASTER_KEY,
      files,
    };
    try {
      await writeBackupArchive(out, this.config.BACKUP_PASSPHRASE!, async (add) => {
        const addHashed = async (name: string, body: Readable, size: number, contentType?: string) => {
          const h = hashing();
          await add(name, body.pipe(h.stream), size);
          files.push({ name, ...h.digest(), ...(contentType ? { contentType } : {}) });
        };
        await addHashed('database.dump', createReadStream(dump), (await stat(dump)).size);
        for (const key of await this.storage.list('')) {
          if (key.startsWith('exports/') || key.startsWith(BACKUP_PREFIX) || key.startsWith('restore/')) continue;
          const obj = await this.storage.getStream(key);
          await addHashed(`storage/${key}`, obj.body, obj.size, obj.contentType);
        }
        if (this.config.BACKUP_INCLUDE_MASTER_KEY) {
          const env = Buffer.from(`MASTER_KEY=${this.config.MASTER_KEY}\n`);
          await addHashed('config.env', Readable.from([env]), env.length);
        }
        const json = Buffer.from(JSON.stringify(manifest, null, 2));
        await add('manifest.json', Readable.from([json]), json.length);
      });
    } catch (err) {
      out.destroy(err as Error);
      await stored.catch(() => undefined);
      throw err;
    }
    await stored;
    return manifest;
  }

  /** Reads the stored archive back, decrypts it and checks every file against the manifest. */
  private async verify(dir: string, key: string, manifest: Manifest): Promise<{ sha256: string; size: number }> {
    const copy = join(dir, 'verify.pbk');
    const h = hashing();
    await pipeline((await this.storage.getStream(key)).body, h.stream, createWriteStream(copy));
    const out = join(dir, 'verify');
    const { files } = await readBackupArchive(copy, this.config.BACKUP_PASSPHRASE!, out);
    const stored = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as Manifest;
    if (stored.files.length !== manifest.files.length) throw new Error('Verification failed: the archive is incomplete');
    for (const f of stored.files) {
      if (!files.includes(f.name)) throw new Error(`Verification failed: ${f.name} is missing`);
      const digest = createHash('sha256').update(await readFile(join(out, f.name))).digest('hex');
      if (digest !== f.sha256) throw new Error(`Verification failed: ${f.name} does not match its checksum`);
    }
    return h.digest();
  }

  private async lastMigration(): Promise<string | null> {
    const res = await this.db
      .execute<{ hash: string }>(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
      .catch(() => ({ rows: [] as { hash: string }[] }));
    return res.rows[0]?.hash ?? null;
  }

  private async alert(message: string): Promise<void> {
    try {
      const to = await this.recipients.resolve({ roles: ['super_admin', 'platform_admin'], userIds: [], groupIds: [] }, { customerId: null, groupId: null });
      await this.dispatcher.dispatch(to, {
        type: 'system.backup_failed',
        level: 'critical',
        title: 'Backup failed',
        body: message,
        link: '/system',
        customerId: null,
        email: { template: 'system_alert', vars: { title: 'Backup failed', body: `The scheduled backup did not complete: ${message}. The previous backup is still available.` } },
      }, ['inapp', 'email']);
    } catch (err) {
      this.logger.error(`Could not alert admins about the failed backup: ${(err as Error).message}`);
    }
  }

  /** Keeps temp files from outliving a crash: unfinished uploads older than a day are removed. */
  async cleanupIncoming(now = Date.now()): Promise<void> {
    for (const key of await this.storage.list(`${BACKUP_PREFIX}.incoming-`)) {
      const ts = /incoming-(\d{8}T\d{6}Z)/.exec(key)?.[1];
      const when = ts ? Date.parse(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z`) : 0;
      if (now - when > 86_400_000) await this.storage.delete(key);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}


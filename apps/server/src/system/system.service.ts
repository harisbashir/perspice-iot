import { Inject, Injectable } from '@nestjs/common';
import type { ProcessInfo, SystemStatusDto } from '@perspice/shared';
import { count, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { statfs } from 'node:fs/promises';
import { BackupService } from '../backups/backup.service';
import { Maintenance } from '../backups/maintenance';
import { REDIS } from '../common/redis.module';
import { appVersion } from '../common/version';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { device } from '../db/schema';
import { messageRateKey } from '../ingest/ingest.metrics';
import { SystemCollectors } from './collectors';
import { HEARTBEAT_PREFIX } from './heartbeat';
import { type RoundtripResult, mqttRoundtrip } from './roundtrip';

const ROLES = ['api', 'ingest', 'rules', 'scheduler', 'renderer'];
const RELEASE_KEY = 'system:latest-release';
const RELEASE_TTL_S = 6 * 3600;

/** -1, 0 or 1 comparing dotted versions (pre-release suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** What the System page shows: processes, load, queues, disk and backups. */
@Injectable()
export class SystemService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly collectors: SystemCollectors,
    private readonly backups: BackupService,
    private readonly maintenance: Maintenance,
  ) {}

  roundtrip(): Promise<RoundtripResult> {
    if (this.config.MQTT_TRANSPORT === 'aws-iot') {
      return Promise.resolve({ ok: false, ms: null, message: 'Not available with AWS IoT Core: devices connect to AWS, not this server' });
    }
    return mqttRoundtrip(this.db, this.redis, this.config.MQTT_URL);
  }

  async updateCheck(): Promise<{ current: string; latest: string | null; updateAvailable: boolean; url: string | null }> {
    const current = appVersion();
    let release = await this.redis.get(RELEASE_KEY);
    if (release === null) {
      let found: { latest: string | null; url: string | null } = { latest: null, url: null };
      try {
        const res = await fetch(`https://api.github.com/repos/${this.config.UPDATE_REPO}/releases/latest`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'perspice-update-check' },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const body = (await res.json()) as { tag_name?: string; html_url?: string };
          if (body.tag_name) found = { latest: body.tag_name.replace(/^v/, ''), url: body.html_url ?? null };
        }
      } catch {
        // Offline or rate-limited: no notice, ask again later.
      }
      release = JSON.stringify(found);
      await this.redis.set(RELEASE_KEY, release, 'EX', found.latest ? RELEASE_TTL_S : 1800);
    }
    const { latest, url } = JSON.parse(release) as { latest: string | null; url: string | null };
    return { current, latest, updateAvailable: !!latest && compareVersions(latest, current) > 0, url };
  }

  async processes(): Promise<(ProcessInfo & { websocketClients?: number })[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${HEARTBEAT_PREFIX}*`, 'COUNT', 200);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    const values = keys.length ? await this.redis.mget(...keys) : [];
    return values
      .filter((v): v is string => !!v)
      .map((v) => JSON.parse(v) as ProcessInfo & { websocketClients?: number })
      .sort((a, b) => a.role.localeCompare(b.role) || a.instance.localeCompare(b.instance));
  }

  async status(): Promise<SystemStatusDto> {
    const minute = Math.floor(Date.now() / 60_000);
    const [processes, rate, online, dbSize, backup, maintenance] = await Promise.all([
      this.processes(),
      this.redis.get(messageRateKey(minute - 1)),
      this.db.select({ n: count() }).from(device).where(eq(device.status, 'online')),
      this.db.execute<{ size: string }>(sql`SELECT pg_database_size(current_database())::text AS size`),
      this.backups.status(),
      this.maintenance.state(true),
    ]);
    const queues: SystemStatusDto['queues'] = {};
    for (const [name, q] of Object.entries(this.collectors.queues())) {
      const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
      queues[name] = { waiting: c.waiting ?? 0, active: c.active ?? 0, failed: c.failed ?? 0, delayed: c.delayed ?? 0 };
    }
    let storage: SystemStatusDto['storage'] = { driver: this.config.STORAGE_DRIVER, usedBytes: null, freeBytes: null };
    if (this.config.STORAGE_DRIVER === 'local') {
      const fs = await statfs(this.config.STORAGE_LOCAL_PATH).catch(() => null);
      if (fs) storage = { driver: 'local', usedBytes: (fs.blocks - fs.bfree) * fs.bsize, freeBytes: fs.bavail * fs.bsize };
    }
    return {
      version: appVersion(),
      processes: processes.map(({ websocketClients: _w, ...p }) => p),
      expectedRoles: ROLES,
      messagesPerMinute: Number(rate ?? 0),
      connectedDevices: online[0]?.n ?? 0,
      websocketClients: processes.reduce((n, p) => n + (p.websocketClients ?? 0), 0),
      queues,
      database: { sizeBytes: Number(dbSize.rows[0]?.size ?? 0) },
      storage,
      backup: { latest: backup.latest, lastError: backup.lastError, running: backup.running },
      maintenance: !!maintenance,
    };
  }
}

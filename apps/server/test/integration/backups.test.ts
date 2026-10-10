import { eq } from 'drizzle-orm';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBackupArchive } from '../../src/backups/archive';
import { BackupScheduleJob } from '../../src/backups/backup.schedule';
import { BackupService, type Manifest } from '../../src/backups/backup.service';
import { notification } from '../../src/db/schema';
import { SettingsService } from '../../src/settings/settings.service';
import { STORAGE, type StorageDriver } from '../../src/storage/storage.driver';
import { tokenFor } from '../auth-helpers';
import { createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { PG_TOOLS } from '../pg-tools';

const PASSPHRASE = 'a long test backup passphrase';

describe('backups', () => {
  let t: TestApp;
  let auth: string;
  let superId: string;
  let svc: BackupService;
  let storage: StorageDriver;

  beforeAll(async () => {
    t = await createTestApp({ overrides: { BACKUP_PASSPHRASE: PASSPHRASE, ...PG_TOOLS } });
    await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
    const admin = await createUser(t.db, { roleKey: 'super_admin' });
    superId = admin.id;
    auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    svc = t.app.get(BackupService);
    storage = t.app.get<StorageDriver>(STORAGE);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function download(): Promise<{ file: string; dir: string }> {
    const { body } = await t.http.get('/api/system/backups/latest/download').set('Authorization', auth).expect(200);
    const res = await t.http.get(body.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="perspice-backup-.*\.pbk"/);
    const dir = mkdtempSync(join(tmpdir(), 'perspice-dl-'));
    writeFileSync(join(dir, 'b.pbk'), res.body as Buffer);
    return { file: join(dir, 'b.pbk'), dir };
  }

  it('backs up the database and stored files, encrypted, without exports or secrets (Review Focus 1)', async () => {
    await storage.put('assets/logo.svg', Buffer.from('<svg/>'), 'image/svg+xml');
    await storage.put('exports/u/1/big.csv', Buffer.from('a,b'), 'text/csv');
    const start = await t.http.post('/api/system/backups').set('Authorization', auth);
    expect(start.status).toBe(202);
    const status = await waitFor(() => t.http.get('/api/system/backups').set('Authorization', auth).then((r) => r.body), (s) => !!s.latest && !s.running);
    expect(status).toMatchObject({ configured: true, lastError: null, latest: { file: expect.stringMatching(/^perspice-backup-.*\.pbk$/), size: expect.any(Number) } });

    const { file, dir } = await download();
    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from(PASSPHRASE))).toBe(false);
    expect(raw.includes(Buffer.from('<svg/>'))).toBe(false);
    const out = join(dir, 'x');
    const { files } = await readBackupArchive(file, PASSPHRASE, out);
    expect(files.sort()).toEqual(['database.dump', 'manifest.json', 'storage/assets/logo.svg']);
    expect(readFileSync(join(out, 'database.dump')).subarray(0, 5).toString()).toBe('PGDMP');
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest).toMatchObject({ format: 1, includesMasterKey: false, migration: expect.any(String), masterKeyFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(manifest.files.find((f) => f.name === 'storage/assets/logo.svg')).toMatchObject({ contentType: 'image/svg+xml', size: 6 });
  });

  it('keeps exactly one backup, runs one at a time, and keeps the previous one when a backup fails (Review Focus 2)', async () => {
    const results = await Promise.all([svc.run(), svc.run()]);
    expect(results.sort()).toEqual([false, true]);
    expect((await storage.list('backups/')).filter((k) => k.endsWith('.pbk'))).toHaveLength(1);
    const before = await svc.latest();

    const dump = t.config.PG_DUMP_PATH;
    t.config.PG_DUMP_PATH = '/bin/false';
    try {
      await expect(svc.run()).rejects.toThrow(/pg_dump|false/);
    } finally {
      t.config.PG_DUMP_PATH = dump;
    }
    expect(await svc.latest()).toEqual(before);
    expect(await storage.list('backups/')).toEqual([before!.key]);
    const status = await svc.status();
    expect(status.lastError?.message).toMatch(/failed/);
    const alerts = await waitFor(() => t.db.select().from(notification).where(eq(notification.userId, superId)), (n) => n.some((x) => x.type === 'system.backup_failed'), 10_000);
    expect(alerts.some((n) => n.type === 'system.backup_failed' && n.severity === 'critical')).toBe(true);
  });

  it('runs on schedule', async () => {
    await t.http.put('/api/system/backups/schedule').set('Authorization', auth).send({ enabled: true, time: '03:30', timezone: 'UTC' }).expect(200);
    const job = t.app.get(BackupScheduleJob);
    const before = (await svc.latest())!.createdAt;
    expect(await job.tick(Date.now())).toBe(false); // first tick only plans the next run
    expect(await job.tick(Date.now() + 2 * 86_400_000)).toBe(true);
    const after = await waitFor(() => svc.latest(), (l) => !!l && l.createdAt > before);
    expect(after!.createdAt).toBeGreaterThan(before);
  });

  it('is for super admins only', async () => {
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    const pAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    expect((await t.http.get('/api/system/backups').set('Authorization', pAuth)).status).toBe(403);
    expect((await t.http.post('/api/system/backups').set('Authorization', pAuth)).status).toBe(403);
    expect((await t.http.get('/api/system/backups/latest/download').set('Authorization', pAuth)).status).toBe(403);
  });
});

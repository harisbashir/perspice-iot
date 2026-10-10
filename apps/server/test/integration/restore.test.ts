import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeBackupArchive } from '../../src/backups/archive';
import { BackupService, type Manifest } from '../../src/backups/backup.service';
import { Maintenance } from '../../src/backups/maintenance';
import { sha256Hex } from '../../src/common/crypto';
import { appVersion } from '../../src/common/version';
import { device } from '../../src/db/schema';
import { SettingsService } from '../../src/settings/settings.service';
import { STORAGE, type StorageDriver } from '../../src/storage/storage.driver';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { runCli } from '../../src/cli';
import { type TestApp, createTestApp, testEnv } from '../harness';
import { PG_TOOLS } from '../pg-tools';

const PASSPHRASE = 'a long test backup passphrase';

describe('restore (Review Focus 3)', () => {
  let t: TestApp;
  let auth: string;
  let storage: StorageDriver;

  beforeAll(async () => {
    t = await createTestApp({ overrides: { BACKUP_PASSPHRASE: PASSPHRASE, ...PG_TOOLS } });
    await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
    const admin = await createUser(t.db, { roleKey: 'super_admin' });
    auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    storage = t.app.get<StorageDriver>(STORAGE);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const upload = (body: Buffer) => t.http.post('/api/system/restore').set('Authorization', auth).set('content-type', 'application/octet-stream').send(body);

  async function finished() {
    for (let i = 0; i < 400; i++) {
      // Status stays reachable during maintenance.
      const s = (await t.http.get('/api/system/restore').set('Authorization', auth)).body;
      if (s.state === 'done' || s.state === 'failed') return s;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('restore did not finish');
  }

  async function latestBackupBytes(): Promise<Buffer> {
    const latest = (await t.app.get(BackupService).latest())!;
    return (await storage.get(latest.key)).body;
  }

  /** An archive with a hand-made manifest (for refusal cases). */
  async function craft(patch: Partial<Manifest>): Promise<Buffer> {
    const dump = Buffer.from('PGDMP not really');
    const manifest: Manifest = {
      format: 1,
      version: appVersion(),
      createdAt: Date.now(),
      migration: null,
      masterKeyFingerprint: sha256Hex(t.config.masterKey.toString('base64')).slice(0, 16),
      includesMasterKey: false,
      files: [{ name: 'database.dump', size: dump.length, sha256: createHash('sha256').update(dump).digest('hex') }],
      ...patch,
    };
    const file = join(mkdtempSync(join(tmpdir(), 'perspice-craft-')), 'x.pbk');
    await writeBackupArchive(createWriteStream(file), PASSPHRASE, async (add) => {
      await add('database.dump', Readable.from([dump]), dump.length);
      const json = Buffer.from(JSON.stringify(manifest));
      await add('manifest.json', Readable.from([json]), json.length);
    });
    await new Promise((r) => setTimeout(r, 50));
    return readFileSync(file);
  }

  it('restores deleted data and files from an uploaded backup', async () => {
    const profile = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: profile.id, name: 'Before backup' });
    await storage.put('assets/logo.svg', Buffer.from('<svg>old</svg>'), 'image/svg+xml');
    await t.app.get(BackupService).run();
    const backup = await latestBackupBytes();

    await t.db.delete(device).where(eq(device.id, d.id));
    await storage.put('assets/logo.svg', Buffer.from('<svg>changed</svg>'), 'image/svg+xml');
    await storage.put('assets/added-later.png', Buffer.from('png'), 'image/png');

    const res = await upload(backup);
    expect(res.status).toBe(202);
    const s = await finished();
    expect(s).toMatchObject({ state: 'done', message: expect.stringMatching(/^Restored the backup from/) });
    expect(await t.db.query.device.findFirst({ where: eq(device.id, d.id) })).toMatchObject({ name: 'Before backup' });
    expect((await storage.get('assets/logo.svg')).body.toString()).toBe('<svg>old</svg>');
    expect(await storage.list('assets/')).toEqual(['assets/logo.svg']);
    expect(await t.app.get(Maintenance).state(true)).toBeNull();
    expect((await t.http.get('/api/devices').set('Authorization', auth)).status).toBe(200);
    expect(await storage.list('restore/')).toEqual([]);
  });

  it('refuses newer, foreign-key and damaged backups before touching anything', async () => {
    const before = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM device`)).rows[0]!.n;
    const cases: [Buffer, RegExp][] = [
      [await craft({ version: '0.99.0' }), /newer version/],
      [await craft({ version: '7.0.0' }), /different major version/],
      [await craft({ masterKeyFingerprint: 'ffffffffffffffff' }), /different MASTER_KEY/],
      [await craft({ files: [{ name: 'database.dump', size: 1, sha256: '0'.repeat(64) }] }), /checksum/],
      [Buffer.from('definitely not a backup'), /not a Perspice backup/],
    ];
    for (const [body, reason] of cases) {
      expect((await upload(body)).status).toBe(202);
      const s = await finished();
      expect(s.state).toBe('failed');
      expect(s.message).toMatch(reason);
      expect(await t.app.get(Maintenance).state(true)).toBeNull();
    }
    expect((await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM device`)).rows[0]!.n).toBe(before);
  });

  it('keeps the live database when the restore itself fails, and always leaves maintenance', async () => {
    const profile = await createProfile(t.db);
    const { device: keep } = await createDevice(t.db, { profileId: profile.id, name: 'Still here' });
    await t.app.get(BackupService).run();
    const backup = await latestBackupBytes();
    const restoreTool = t.config.PG_RESTORE_PATH;
    t.config.PG_RESTORE_PATH = '/bin/false';
    try {
      await upload(backup);
      const s = await finished();
      expect(s).toMatchObject({ state: 'failed', message: expect.stringMatching(/pg_restore|false/) });
    } finally {
      t.config.PG_RESTORE_PATH = restoreTool;
    }
    expect(await t.db.query.device.findFirst({ where: eq(device.id, keep.id) })).toMatchObject({ name: 'Still here' });
    expect(await t.app.get(Maintenance).state(true)).toBeNull();
    const sides = await t.db.execute<{ datname: string }>(sql`SELECT datname FROM pg_database WHERE datname LIKE '%_restore'`);
    expect(sides.rows).toEqual([]);
  });

  it('answers 503 during maintenance, except health and restore status', async () => {
    const m = t.app.get(Maintenance);
    await m.begin('test');
    try {
      const res = await t.http.get('/api/devices').set('Authorization', auth);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MAINTENANCE');
      expect((await t.http.get('/health')).status).toBe(200);
      expect((await t.http.get('/api/system/restore').set('Authorization', auth)).status).toBe(200);
    } finally {
      await m.end();
    }
    expect((await t.http.get('/api/devices').set('Authorization', auth)).status).toBe(200);
  });

  it('backs up and restores through the CLI', async () => {
    const env = { ...testEnv(t.config.DATABASE_URL), STORAGE_LOCAL_PATH: t.config.STORAGE_LOCAL_PATH, BACKUP_PASSPHRASE: PASSPHRASE, ...PG_TOOLS };
    const lines: string[] = [];
    const io = { env, out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const out = join(mkdtempSync(join(tmpdir(), 'perspice-cli-')), 'cli.pbk');
    const profile = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: profile.id, name: 'CLI device' });

    expect(await runCli(['backup', '--out', out], io)).toBe(0);
    expect(readFileSync(out).subarray(0, 6).toString()).toBe('PSPBK1');
    await t.db.delete(device).where(eq(device.id, d.id));

    expect(await runCli(['restore', out], io)).toBe(0);
    expect(lines.join('\n')).toMatch(/Restored the backup from/);
    expect(await t.db.query.device.findFirst({ where: eq(device.id, d.id) })).toMatchObject({ name: 'CLI device' });
    expect(await runCli(['restore'], io)).toBe(2);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Maintenance } from '../../src/backups/maintenance';
import { IngestMetrics } from '../../src/ingest/ingest.metrics';
import { SettingsService } from '../../src/settings/settings.service';
import { Heartbeat } from '../../src/system/heartbeat';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('system status', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
    const admin = await createUser(t.db, { roleKey: 'super_admin' });
    auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('reports processes, load, queues, storage and backups', async () => {
    const profile = await createProfile(t.db);
    await createDevice(t.db, { profileId: profile.id, status: 'online' });
    await t.app.get(Heartbeat).beat();
    // Messages counted in the previous minute.
    const metrics = t.app.get(IngestMetrics);
    metrics.inc('ingest_messages_total', 42, { result: 'accepted' });
    await metrics.flush(Date.now() - 60_000);

    const res = await t.http.get('/api/system/status').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: expect.any(String),
      expectedRoles: ['api', 'ingest', 'rules', 'scheduler', 'renderer'],
      messagesPerMinute: 42,
      connectedDevices: 1,
      websocketClients: 0,
      database: { sizeBytes: expect.any(Number) },
      storage: { driver: 'local', usedBytes: expect.any(Number), freeBytes: expect.any(Number) },
      backup: { latest: null, running: false },
      maintenance: false,
    });
    expect(res.body.processes).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'all', version: res.body.version })]));
    expect(Object.keys(res.body.queues).sort()).toEqual(['email', 'exports', 'maintenance', 'notify', 'reports']);
    expect(res.body.database.sizeBytes).toBeGreaterThan(0);
  });

  it('is for system admins; maintenance state is public', async () => {
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    const pAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    expect((await t.http.get('/api/system/status').set('Authorization', pAuth)).status).toBe(403);
    expect((await t.http.get('/api/public/maintenance')).body).toEqual({ maintenance: false, since: null });
    await t.app.get(Maintenance).begin('test');
    try {
      expect((await t.http.get('/api/public/maintenance')).body).toMatchObject({ maintenance: true, since: expect.any(Number) });
    } finally {
      await t.app.get(Maintenance).end();
    }
  });
});

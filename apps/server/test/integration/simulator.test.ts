import { eq, sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimDevice } from '../../../simulator/src/device.js';
import { runSimulation } from '../../../simulator/src/run.js';
import { device } from '../../src/db/schema';
import { OtaService } from '../../src/firmware/ota.service';
import { tokenFor } from '../auth-helpers';
import { createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('device simulator', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('provisions devices, publishes for the duration and measures latency', async () => {
    const admin = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    const key = await t.http
      .post('/api/api-keys')
      .set('Authorization', auth)
      .send({ name: 'sim', permissions: ['device.read', 'device.write', 'profile.read', 'telemetry.read'] });
    const profile = await createProfile(t.db, {
      name: 'Sim Profile',
      telemetrySchema: [{ key: 'fuel_level', label: 'Fuel', type: 'number' }],
    });

    const report = await runSimulation({
      url: await t.baseUrl(),
      apiKey: key.body.key,
      mqtt: t.mqttUrl!,
      profile: profile.name,
      count: 5,
      intervalS: 1,
      durationS: 5,
      create: true,
      sleepy: false,
      http: false,
      measureLatency: true,
      devicesFile: join(mkdtempSync(join(tmpdir(), 'sim-')), 'devices.json'),
      createConcurrency: 3,
      log: () => undefined,
    });

    expect(report.devices).toBe(5);
    expect(report.errors).toBe(0);
    expect(report.sent).toBeGreaterThanOrEqual(20);
    expect(report.latencyMs.samples).toBeGreaterThan(0);
    expect(report.latencyMs.p95).toBeLessThan(2000);

    expect(report.perMinute).toHaveLength(1);
    expect(report.perMinute[0]!.sent).toBe(report.sent);
    expect(report.endedAt - report.startedAt).toBeGreaterThanOrEqual(5000);

    await new Promise((r) => setTimeout(r, 500));
    // No loss: every message sent is stored once, inside the reported window (the load test's check).
    const res = await t.db.execute<{ devices: number; messages: number }>(
      sql`SELECT count(DISTINCT device_id)::int AS devices, count(*)::int AS messages FROM telemetry
          WHERE key = 'fuel_level' AND ts >= to_timestamp(${report.startedAt} / 1000.0) AND ts <= to_timestamp(${report.endedAt} / 1000.0)`,
    );
    expect(res.rows[0]).toEqual({ devices: 5, messages: report.sent });
  });

  it('mobile devices report positions that become device locations', async () => {
    const admin = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    const key = await t.http.post('/api/api-keys').set('Authorization', auth).send({ name: 'sim-mobile', permissions: ['device.read', 'device.write', 'profile.read'] });
    const profile = await createProfile(t.db, { name: 'Tracker Sim', locationMode: 'reported', telemetrySchema: [{ key: 'batt_v', label: 'Battery', type: 'number' }] });
    const report = await runSimulation({
      url: await t.baseUrl(),
      apiKey: key.body.key,
      mqtt: t.mqttUrl!,
      profile: profile.name,
      count: 3,
      intervalS: 1,
      durationS: 3,
      create: true,
      sleepy: false,
      http: false,
      measureLatency: false,
      devicesFile: join(mkdtempSync(join(tmpdir(), 'sim-')), 'devices.json'),
      createConcurrency: 3,
      mobileShare: 1,
      mobileArea: { center: { lat: 48.85, lng: 2.35 }, radiusKm: 2 },
      log: () => undefined,
    });
    expect(report.errors).toBe(0);
    const res = await t.http.get(`/api/devices?profileId=${profile.id}`).set('Authorization', auth);
    const located = (res.body.items as { location: { lat: number; lng: number } | null }[]).filter((d) => d.location);
    expect(located).toHaveLength(3);
    for (const d of located) expect(Math.abs(d.location!.lat - 48.85)).toBeLessThan(0.05);
  });

  it('--ota: downloads the image, checks it, reports progress and comes back on the new version', async () => {
    const admin = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    const profile = await createProfile(t.db, { name: 'OTA Sim' });
    const created = await t.http.post('/api/devices').set('Authorization', auth).send({ name: 'sim-ota', profileId: profile.id });
    const events: string[] = [];
    const sim = new SimDevice({
      id: created.body.device.id,
      token: created.body.token,
      mqttUrl: t.mqttUrl!,
      apiUrl: await t.baseUrl(),
      keys: [],
      http: false,
      sleepy: false,
      firmwareVersion: '1.0.0',
      ota: true,
      onOta: (e) => events.push(e),
      onSent: () => undefined,
      onError: (err) => events.push(`error: ${err.message}`),
    });
    await sim.start();
    try {
      await eventually(() => t.db.query.device.findFirst({ where: eq(device.id, created.body.device.id) }), (d) => d?.firmwareVersion === '1.0.0' && d.status === 'online');
      const fw = await t.http
        .post(`/api/firmware?profileId=${profile.id}&version=1.1.0`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(4096, 3));
      expect(fw.status).toBe(201);
      const job = await t.http.post('/api/ota-jobs').set('Authorization', auth).send({ firmwareId: fw.body.id, target: { kind: 'devices', deviceIds: [created.body.device.id] } });
      expect(job.status).toBe(201);
      const ota = t.app.get(OtaService);
      const done = await eventually(
        async () => {
          await ota.tick();
          return (await t.http.get(`/api/ota-jobs/${job.body.id}`).set('Authorization', auth)).body;
        },
        (j) => j.status === 'completed',
        30_000,
      );
      expect(done.counts.applied).toBe(1);
      expect(sim.firmwareVersion).toBe('1.1.0');
      expect(events).toEqual(expect.arrayContaining(['downloading 0%', 'verifying 100%', 'applied 100%', 'running 1.1.0']));
    } finally {
      await sim.stop();
    }
  }, 60_000);
});

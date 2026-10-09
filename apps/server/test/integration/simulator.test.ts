import { sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSimulation } from '../../../simulator/src/run.js';
import { tokenFor } from '../auth-helpers';
import { createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

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
});

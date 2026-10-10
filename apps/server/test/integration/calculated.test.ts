import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telemetry } from '../../src/db/schema';
import { TelemetryStore } from '../../src/ingest/telemetry-store';
import { tokenFor } from '../auth-helpers';
import { createDevice, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('calculated telemetry', () => {
  let t: TestApp;
  let auth: string;
  const T0 = Date.now() - 3_600_000;

  beforeAll(async () => {
    t = await createTestApp();
    const admin = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function profileWith(calculated: object[], telemetrySchema: object[] = []) {
    const res = await t.http.post('/api/device-profiles').set('Authorization', auth).send({ name: `Calc ${Math.random()}`, telemetrySchema, calculated });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; calculated: object[] };
  }

  async function deviceOn(profileId: string) {
    const { device, token } = await createDevice(t.db, { profileId });
    const send = async (values: Record<string, unknown>, ts: number) => {
      const res = await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ ts, values });
      expect(res.status).toBe(202);
    };
    const stored = async (key: string) => {
      await t.app.get(TelemetryStore).writer.flush();
      const rows = await t.db
        .select({ ts: telemetry.ts, v: telemetry.valueNum, b: telemetry.valueBool })
        .from(telemetry)
        .where(and(eq(telemetry.deviceId, device.id), eq(telemetry.key, key)))
        .orderBy(asc(telemetry.ts));
      return rows.map((r) => [r.ts.getTime() - T0, r.v ?? r.b]);
    };
    const latest = async () => (await t.http.get(`/api/devices/${device.id}`).set('Authorization', auth)).body.latest as Record<string, { v: unknown }>;
    return { id: device.id, send, stored, latest };
  }

  it('rejects invalid definitions when the profile is saved', async () => {
    const res = await t.http
      .post('/api/device-profiles')
      .set('Authorization', auth)
      .send({ name: 'Bad', telemetrySchema: [{ key: 'v', label: 'V', type: 'number' }], calculated: [{ key: 'v', label: 'V', kind: 'formula', expr: '1 +' }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('already a telemetry key');
    expect(JSON.stringify(res.body.details)).toContain('Expected a value');
  });

  it('computes formulas over the message and the latest values, chained in order', async () => {
    const p = await profileWith([
      { key: 'power', label: 'Power', unit: 'W', kind: 'formula', expr: 'v * i * pf' },
      { key: 'power_kw', label: 'Power', unit: 'kW', kind: 'formula', expr: 'round(power / 1000, 3)' },
      { key: 'overload', label: 'Overload', kind: 'formula', expr: 'power > 5000' },
    ]);
    const d = await deviceOn(p.id);
    await d.send({ v: 230, pf: 0.9 }, T0); // no i yet: nothing calculated
    await d.send({ i: 10 }, T0 + 1000); // v and pf from the latest values
    await d.send({ v: 240, i: 30 }, T0 + 2000);
    expect(await d.stored('power')).toEqual([
      [1000, 2070],
      [2000, 6480],
    ]);
    expect(await d.stored('power_kw')).toEqual([
      [1000, 2.07],
      [2000, 6.48],
    ]);
    expect(await d.stored('overload')).toEqual([
      [1000, false],
      [2000, true],
    ]);
    expect((await d.latest()).power?.v).toBe(6480);
  });

  it('replaces a value the device sends under a calculated name; bad inputs skip only that key', async () => {
    const p = await profileWith([{ key: 'double', label: 'Double', kind: 'formula', expr: 'x * 2' }]);
    const d = await deviceOn(p.id);
    await d.send({ x: 4, double: 999, other: 1 }, T0);
    await d.send({ x: 'broken', other: 2 }, T0 + 1000);
    expect(await d.stored('double')).toEqual([[0, 8]]);
    expect(await d.stored('other')).toEqual([
      [0, 1],
      [1000, 2],
    ]);
  });

  it('counter_delta: consumption between readings, resets and implausible jumps', async () => {
    const p = await profileWith([{ key: 'energy_used', label: 'Energy used', unit: 'kWh', kind: 'counter_delta', source: 'energy_kwh', maxDelta: 100 }], [{ key: 'energy_kwh', label: 'Energy', type: 'number' }]);
    const d = await deviceOn(p.id);
    await d.send({ energy_kwh: 1000 }, T0); // first reading: nothing to compare
    await d.send({ energy_kwh: 1012.5 }, T0 + 1000);
    await d.send({ energy_kwh: 1010 }, T0 + 500); // older than the last reading: ignored
    await d.send({ energy_kwh: 3 }, T0 + 2000); // the meter was reset
    await d.send({ energy_kwh: 5000 }, T0 + 3000); // a jump above maxDelta: dropped, but the reading counts
    await d.send({ energy_kwh: 5004 }, T0 + 4000);
    expect(await d.stored('energy_used')).toEqual([
      [1000, 12.5],
      [2000, 3],
      [4000, 4],
    ]);
    const debug = (await t.http.get(`/api/devices/${d.id}/debug`).set('Authorization', auth)).body as { summary: string }[];
    expect(debug.some((e) => e.summary.includes('energy_used') && e.summary.includes('maxDelta'))).toBe(true);
  });

  it('runtime: seconds running since the previous message, long gaps not counted', async () => {
    const p = await profileWith([{ key: 'run_s', label: 'Run time', unit: 's', kind: 'runtime', source: 'gen_running', gapCapS: 600 }], [{ key: 'gen_running', label: 'Running', type: 'boolean' }]);
    const d = await deviceOn(p.id);
    await d.send({ gen_running: true }, T0);
    await d.send({ gen_running: true }, T0 + 60_000); // ran the whole minute
    await d.send({ gen_running: false }, T0 + 120_000); // ran until now
    await d.send({ gen_running: true }, T0 + 180_000); // was stopped
    await d.send({ gen_running: true }, T0 + 1_380_000); // 20 min gap: unknown, not counted
    expect(await d.stored('run_s')).toEqual([
      [60_000, 60],
      [120_000, 60],
      [180_000, 0],
      [1_380_000, 0],
    ]);
  });

  it('fuel_used: drops beyond the deadband, refuels ignored', async () => {
    const p = await profileWith([{ key: 'fuel_used', label: 'Fuel used', unit: 'L', kind: 'fuel_used', source: 'fuel_l', deadband: 1 }], [{ key: 'fuel_l', label: 'Fuel', type: 'number' }]);
    const d = await deviceOn(p.id);
    await d.send({ fuel_l: 200 }, T0);
    await d.send({ fuel_l: 199.5 }, T0 + 1000); // within the deadband: nothing yet
    await d.send({ fuel_l: 198 }, T0 + 2000); // 2 L below the last reference
    await d.send({ fuel_l: 260 }, T0 + 3000); // refuel
    await d.send({ fuel_l: 255 }, T0 + 4000);
    expect(await d.stored('fuel_used')).toEqual([
      [1000, 0],
      [2000, 2],
      [3000, 0],
      [4000, 5],
    ]);
  });

  it('profiles without calculated keys are untouched', async () => {
    const p = await profileWith([]);
    const d = await deviceOn(p.id);
    await d.send({ a: 1 }, T0);
    expect(await d.stored('a')).toEqual([[0, 1]]);
    expect(await t.redis.exists(`calc:${d.id}`)).toBe(0);
  });
});

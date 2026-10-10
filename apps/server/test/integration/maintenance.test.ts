import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmEngine } from '../../src/alarms/engine';
import { MaintenanceService } from '../../src/alarms/maintenance.service';
import { TelemetryStore } from '../../src/ingest/telemetry-store';
import { alarm, device as deviceTable, telemetry } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const H = 3_600_000;

describe('run hours and maintenance reminders', () => {
  let t: TestApp;
  let platform: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant() {
    const c = await createCustomer(t.db);
    const login = async (role: 'customer_admin' | 'customer_operator' | 'customer_viewer') => {
      const u = await createUser(t.db, { roleKey: role, customerId: c.id });
      return `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    };
    return { c, admin: await login('customer_admin'), operator: await login('customer_operator'), viewer: await login('customer_viewer') };
  }

  /** Seconds run, as a runtime key stores them. */
  const ran = (deviceId: string, hours: number, ts = Date.now()) => t.db.insert(telemetry).values({ deviceId, key: 'run_s', ts: new Date(ts), valueNum: hours * 3600 });
  const rule = (profileId: string, condition: object) =>
    t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Generator service', severity: 'major', scope: { kind: 'profile', profileId }, type: 'maintenance_due', condition });
  const open = (deviceId: string) => t.db.query.alarm.findFirst({ where: and(eq(alarm.deviceId, deviceId), eq(alarm.type, 'maintenance_due')) });
  const check = () => t.app.get(MaintenanceService).check();

  it('validates the condition', async () => {
    const p = await createProfile(t.db);
    expect((await rule(p.id, {})).status).toBe(400);
    expect((await rule(p.id, { everyHours: 250 })).status).toBe(400); // hours need the runtime key
    expect((await rule(p.id, { runtimeKey: 'run_s', everyHours: 250, everyDays: 180 })).status).toBe(201);
  });

  it('raises after the run hours, and a logged service clears it and restarts the count', async () => {
    const a = await tenant();
    const p = await createProfile(t.db);
    expect((await rule(p.id, { runtimeKey: 'run_s', everyHours: 250 })).status).toBe(201);
    const { device } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    await ran(device.id, 200);
    await check();
    expect(await open(device.id)).toBeUndefined();
    await ran(device.id, 51, Date.now() + 1000);
    await check();
    expect(await open(device.id)).toMatchObject({ status: 'active', severity: 'major', message: 'Service due: 251 h run since the last service (every 250 h)' });

    const hours = await t.http.get(`/api/devices/${device.id}/run-hours`).query({ key: 'run_s' }).set('Authorization', a.viewer);
    expect(hours.body).toEqual({ key: 'run_s', total: 251, sinceService: 251, lastService: null });

    const logged = await t.http.post(`/api/devices/${device.id}/services`).set('Authorization', a.operator).send({ note: 'Oil and filters' });
    expect(logged.status).toBe(201);
    expect(logged.body).toMatchObject({ note: 'Oil and filters', runHours: { run_s: 251 } });
    expect((await open(device.id))?.status).toBe('cleared');

    const after = await t.http.get(`/api/devices/${device.id}/run-hours`).query({ key: 'run_s' }).set('Authorization', a.viewer);
    expect(after.body).toMatchObject({ total: 251, sinceService: 0, lastService: { note: 'Oil and filters', runHours: { run_s: 251 } } });
    const list = await t.http.get(`/api/devices/${device.id}/services`).set('Authorization', a.viewer);
    expect(list.body).toHaveLength(1);
  });

  it('raises by date, and early at remindAtPct', async () => {
    const a = await tenant();
    const p = await createProfile(t.db);
    await rule(p.id, { everyDays: 30 });
    await rule(p.id, { runtimeKey: 'run_s', everyHours: 250, remindAtPct: 90 });
    const { device: old } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    await t.db.update(deviceTable).set({ createdAt: new Date(Date.now() - 40 * 24 * H) }).where(eq(deviceTable.id, old.id));
    const { device: busy } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    await ran(busy.id, 230);
    await check();
    const byDate = await t.db.query.alarm.findMany({ where: eq(alarm.deviceId, old.id) });
    expect(byDate.map((x) => x.message)).toEqual(['Service due: 40 days since the last service (every 30 days)']);
    expect((await open(busy.id))?.message).toBe('Service due soon: 230 h run since the last service (every 250 h)');
  });

  it("keeps service logs to the device's customer and to device.service", async () => {
    const a = await tenant();
    const b = await tenant();
    const p = await createProfile(t.db);
    const { device } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    expect((await t.http.post(`/api/devices/${device.id}/services`).set('Authorization', a.viewer).send({})).status).toBe(403);
    expect((await t.http.post(`/api/devices/${device.id}/services`).set('Authorization', b.admin).send({})).status).toBe(404);
    expect((await t.http.get(`/api/devices/${device.id}/services`).set('Authorization', b.admin)).status).toBe(404);
    expect((await t.http.get(`/api/devices/${device.id}/run-hours`).query({ key: 'run_s' }).set('Authorization', b.admin)).status).toBe(404);
  });

  it('re-checks a device as soon as its run time reports, without waiting for the hourly check', async () => {
    const a = await tenant();
    const res = await t.http
      .post('/api/device-profiles')
      .set('Authorization', platform)
      .send({
        name: `Generator ${Math.random()}`,
        telemetrySchema: [{ key: 'gen_running', label: 'Running', type: 'boolean' }],
        calculated: [{ key: 'run_s', label: 'Run time', kind: 'runtime', source: 'gen_running' }],
      });
    const p = res.body as { id: string };
    await rule(p.id, { runtimeKey: 'run_s', everyHours: 0.01 }); // 36 seconds
    const { device, token } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    const now = Date.now();
    for (const ts of [now - 120_000, now - 60_000, now]) {
      expect((await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ ts, values: { gen_running: true } })).status).toBe(202);
    }
    // The engine schedules a check a minute later; the scheduler's timer tick runs it.
    const engine = t.app.get(AlarmEngine);
    let found = await open(device.id);
    for (let i = 0; i < 50 && !found; i++) {
      await t.app.get(TelemetryStore).writer.flush();
      await engine.tick(Date.now() + 61_000);
      found = await open(device.id);
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    expect(found?.message).toMatch(/^Service due: [\d.]+ h run since the last service \(every 0 h\)$/);
  });
});

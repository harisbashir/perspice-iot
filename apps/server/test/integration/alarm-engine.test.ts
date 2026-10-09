import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmStore } from '../../src/alarms/alarm-store';
import { AlarmEngine } from '../../src/alarms/engine';
import { alarm, alarmEvent, alarmRule } from '../../src/db/schema';
import { EventBus } from '../../src/events/event-bus';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('rules engine', () => {
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

  async function setup(rule: Record<string, unknown>) {
    const c = await createCustomer(t.db);
    const profile = await createProfile(t.db);
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id });
    const res = await t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Rule', severity: 'major', scope: { kind: 'profile', profileId: profile.id }, ...rule });
    expect(res.status).toBe(201);
    return { c, profile, device, token, ruleId: res.body.id as string };
  }

  const send = (token: string, values: Record<string, unknown>) =>
    t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values }).expect(202);

  const alarmsOf = (deviceId: string) => t.db.select().from(alarm).where(eq(alarm.deviceId, deviceId));

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const lowFuel = { type: 'threshold', condition: { key: 'fuel_level', op: '<', value: 20 }, clear: { margin: 2 } };

  it('raises once within 2 s, ignores repeats, and clears past the margin', async () => {
    const { device, token } = await setup(lowFuel);
    const started = Date.now();
    await send(token, { fuel_level: 15 });
    const raised = await until(() => alarmsOf(device.id), (a) => a.length === 1, 2000);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(raised[0]).toMatchObject({ status: 'active', severity: 'major', value: { key: 'fuel_level', v: 15 }, message: 'fuel_level is 15 (< 20)' });

    await send(token, { fuel_level: 14 });
    await send(token, { fuel_level: 21 }); // inside the margin: still active
    await new Promise((r) => setTimeout(r, 300));
    expect(await alarmsOf(device.id)).toMatchObject([{ status: 'active' }]);

    await send(token, { fuel_level: 23 });
    const cleared = await until(() => alarmsOf(device.id), (a) => a[0]?.status === 'cleared');
    expect(cleared[0]).toMatchObject({ status: 'cleared', clearReason: 'condition' });
    const events = await t.db.select().from(alarmEvent).where(eq(alarmEvent.alarmId, cleared[0]!.id));
    expect(events.map((e) => e.type).sort()).toEqual(['cleared', 'raised']);

    await send(token, { fuel_level: 10 });
    expect(await until(() => alarmsOf(device.id), (a) => a.length === 2)).toHaveLength(2);
  });

  it('collapses concurrent raises into one alarm (Review Focus 1)', async () => {
    const { c, profile, device, ruleId } = await setup(lowFuel);
    const rule = (await t.db.query.alarmRule.findFirst({ where: eq(alarmRule.id, ruleId) }))!;
    const store = t.app.get(AlarmStore);
    const target = { id: device.id, profileId: profile.id, customerId: c.id };
    const results = await Promise.all(Array.from({ length: 8 }, () => store.raise(rule, target, { key: 'fuel_level', v: 1 }, 'm', Date.now())));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await alarmsOf(device.id)).toHaveLength(1);
  });

  it('raises on status changes and clears when the device is back online', async () => {
    const { c, device } = await setup({ type: 'status', condition: { statuses: ['offline', 'dead'] } });
    const bus = t.app.get(EventBus);
    const status = (from: string, to: string) =>
      bus.publish({ type: 'device.status_changed', deviceId: device.id, customerId: c.id, from: from as never, to: to as never, reason: 'test', ts: Date.now() });
    await status('online', 'offline');
    expect(await until(() => alarmsOf(device.id), (a) => a.length === 1)).toMatchObject([{ status: 'active', message: 'Device is offline' }]);
    await status('offline', 'online');
    expect(await until(() => alarmsOf(device.id), (a) => a[0]?.status === 'cleared')).toMatchObject([{ status: 'cleared' }]);
  });

  it('fires no-data and duration timers from the scheduler tick', async () => {
    const engine = t.app.get(AlarmEngine);
    const nodata = await setup({ type: 'no_data_key', condition: { key: 'fuel_level', forS: 60 } });
    await send(nodata.token, { fuel_level: 50 });
    const hot = await setup({ type: 'duration', condition: { key: 'temp', op: '>', value: 40, forS: 120 }, clear: { margin: 1 } });
    await send(hot.token, { temp: 45 });
    await new Promise((r) => setTimeout(r, 500)); // let the engine record the state

    await engine.tick(Date.now() + 30_000);
    expect(await alarmsOf(nodata.device.id)).toHaveLength(0);
    await engine.tick(Date.now() + 130_000);
    expect(await alarmsOf(nodata.device.id)).toMatchObject([{ status: 'active', type: 'no_data_key' }]);
    expect(await alarmsOf(hot.device.id)).toMatchObject([{ status: 'active', type: 'duration' }]);
  });

  it('respects disabled rules and device opt-outs; disabling clears open alarms', async () => {
    const { c, profile, device, token, ruleId } = await setup(lowFuel);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}`;
    const { device: other, token: otherToken } = await createDevice(t.db, { profileId: profile.id, customerId: c.id });
    const optOut = await t.http
      .post('/api/alarm-rules')
      .set('Authorization', auth)
      .send({ name: 'Not here', severity: 'major', scope: { kind: 'device', deviceId: other.id }, ...lowFuel, disablesRuleId: ruleId });
    expect(optOut.status).toBe(201);

    await send(token, { fuel_level: 5 });
    await send(otherToken, { fuel_level: 5 });
    await until(() => alarmsOf(device.id), (a) => a.length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(await alarmsOf(other.id)).toHaveLength(0);

    const disable = await t.http
      .put(`/api/alarm-rules/${ruleId}`)
      .set('Authorization', platform)
      .send({ name: 'Rule', severity: 'major', scope: { kind: 'profile', profileId: profile.id }, ...lowFuel, enabled: false });
    expect(disable.status).toBe(200);
    expect(await t.db.select().from(alarm).where(and(eq(alarm.deviceId, device.id), eq(alarm.status, 'cleared')))).toMatchObject([{ clearReason: 'rule_removed' }]);
    await send(token, { fuel_level: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(await alarmsOf(device.id)).toHaveLength(1);
  });
});

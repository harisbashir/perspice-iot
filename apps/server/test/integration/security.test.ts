import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { role, user } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectSocket } from '../socket-helpers';

/** Findings of the v1.0 security review, kept as regressions. */
describe('security review', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('dashboard data honours permissions, not only scope (a custom role without telemetry or alarm access)', async () => {
    const c = await createCustomer(t.db);
    const profile = await createProfile(t.db, { telemetrySchema: [{ key: 'temp', label: 'Temp', type: 'number' }] });
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id });
    await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: { temp: 21 } });
    const [limited] = await t.db.insert(role).values({ name: 'Device list only', scope: 'customer', customerId: c.id, permissions: ['device.read'] }).returning();
    const u = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    await t.db.update(user).set({ roleId: limited!.id }).where(eq(user.id, u.id));
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;

    const res = await t.http
      .post('/api/dashboards/data')
      .set('Authorization', auth)
      .send({
        deviceId: device.id,
        requests: [
          { widgetId: 'values', datasource: { kind: 'currentDevice', keys: ['temp'] }, mode: 'latest' },
          { widgetId: 'history', datasource: { kind: 'currentDevice', keys: ['temp'] }, mode: 'history' },
          { widgetId: 'fleet', datasource: { kind: 'devicesOfProfile', profileId: null, keys: ['temp'] }, mode: 'latest' },
          { widgetId: 'alarms', datasource: { kind: 'alarms', filter: {} }, mode: 'list' },
          { widgetId: 'count', datasource: { kind: 'devicesOfProfile', profileId: null, keys: [] }, mode: 'stats' },
        ],
      });
    expect(res.status).toBe(200);
    const r = res.body.results;
    for (const w of ['values', 'history', 'fleet', 'alarms']) expect(r[w], w).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    // Counting devices only needs device.read.
    expect(r.count).toMatchObject({ ok: true, data: { total: 1 } });
  });

  it('live subscriptions honour permissions too', async () => {
    const c = await createCustomer(t.db);
    const profile = await createProfile(t.db);
    const { device } = await createDevice(t.db, { profileId: profile.id, customerId: c.id });
    const [noValues] = await t.db.insert(role).values({ name: 'No values', scope: 'customer', customerId: c.id, permissions: ['device.read'] }).returning();
    const [nothing] = await t.db.insert(role).values({ name: 'Nothing', scope: 'customer', customerId: c.id, permissions: [] }).returning();
    const login = async (roleId: string) => {
      const u = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
      await t.db.update(user).set({ roleId }).where(eq(user.id, u.id));
      return connectSocket(await t.baseUrl(), await tokenFor(t, u.email, u.password, `${c.slug}.localhost`));
    };
    const limited = await login(noValues!.id);
    const none = await login(nothing!.id);
    try {
      expect(await limited.emitWithAck('subscribe:device', { deviceId: device.id })).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(await limited.emitWithAck('subscribe:devices', { deviceIds: [device.id] })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      expect(await limited.emitWithAck('subscribe:status', {})).toEqual({ ok: true });
      expect(await none.emitWithAck('subscribe:status', {})).toEqual({ ok: false, code: 'FORBIDDEN' });
    } finally {
      limited.disconnect();
      none.disconnect();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const CENTER = { lat: 51.5, lng: -0.12 };
/** `m` metres north of the depot's centre. */
const north = (m: number) => ({ lat: CENTER.lat + m / 111_195, lng: CENTER.lng });

describe('geofence alarm rules', () => {
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
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    const profile = await createProfile(t.db, { locationMode: 'reported' });
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Van 7' });
    const depot = (await t.http.post('/api/geofences').set('Authorization', auth).send({ name: 'Depot', shape: { type: 'circle', center: CENTER, radiusM: 500 } })).body;
    const send = (m: number) => t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: north(m) }).expect(202);
    return { c, auth, profile, device, depot, send };
  }

  const rule = (auth: string, body: object) => t.http.post('/api/alarm-rules').set('Authorization', auth).send({ name: 'Left depot', severity: 'major', ...body });
  const alarms = (auth: string, q: string) => t.http.get(`/api/alarms?${q}`).set('Authorization', auth);

  async function waitFor(auth: string, q: string, ok: (items: { status: string; message: string }[]) => boolean) {
    for (let i = 0; i < 100; i++) {
      const items = (await alarms(auth, q)).body.items as { status: string; message: string }[];
      if (ok(items)) return items;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('alarm state not reached');
  }

  it('raises when the device leaves, and clears only once it is back by the margin', async () => {
    const a = await tenant();
    const created = await rule(a.auth, { type: 'geofence', scope: { kind: 'customer', customerId: a.c.id }, condition: { geofenceId: a.depot.id } });
    expect(created.status).toBe(201);
    await a.send(300);
    await a.send(800);
    const [raised] = await waitFor(a.auth, `deviceId=${a.device.id}&status=active`, (i) => i.length === 1);
    expect(raised).toMatchObject({ message: 'Left Depot', status: 'active' });
    await a.send(495); // 5 m inside: GPS jitter, stays raised
    await new Promise((r) => setTimeout(r, 300));
    expect((await alarms(a.auth, `deviceId=${a.device.id}&status=active`)).body.items).toHaveLength(1);
    await a.send(450);
    await waitFor(a.auth, `deviceId=${a.device.id}&status=cleared`, (i) => i.length === 1);
  });

  it('refuses geofences the rule can not use', async () => {
    const a = await tenant();
    const b = await tenant();
    // Another customer's geofence: not found.
    expect((await rule(a.auth, { type: 'geofence', scope: { kind: 'customer', customerId: a.c.id }, condition: { geofenceId: b.depot.id } })).status).toBe(404);
    // A profile rule spans every customer, so it needs a platform-wide geofence.
    const profileRule = await rule(platform, { type: 'geofence', scope: { kind: 'profile', profileId: a.profile.id }, condition: { geofenceId: a.depot.id } });
    expect(profileRule.status).toBe(400);
    expect(JSON.stringify(profileRule.body)).toMatch(/platform-wide/);
    const shared = (await t.http.post('/api/geofences').set('Authorization', platform).send({ name: 'Port', shape: { type: 'circle', center: CENTER, radiusM: 900 }, customerId: null })).body;
    expect((await rule(platform, { type: 'geofence', scope: { kind: 'profile', profileId: a.profile.id }, condition: { geofenceId: shared.id } })).status).toBe(201);
    // Customers may use platform-wide geofences in their own rules.
    expect((await rule(a.auth, { type: 'geofence', scope: { kind: 'device', deviceId: a.device.id }, condition: { geofenceId: shared.id } })).status).toBe(201);
  });

  it('a geofence used by rules can not be deleted until the rules are gone', async () => {
    const a = await tenant();
    const r = (await rule(a.auth, { type: 'geofence', scope: { kind: 'customer', customerId: a.c.id }, condition: { geofenceId: a.depot.id } })).body;
    const del = await t.http.delete(`/api/geofences/${a.depot.id}`).set('Authorization', a.auth);
    expect(del.status).toBe(409);
    expect(del.body.message).toContain('Left depot');
    expect((await t.http.delete(`/api/alarm-rules/${r.id}`).set('Authorization', a.auth)).status).toBe(204);
    expect((await t.http.delete(`/api/geofences/${a.depot.id}`).set('Authorization', a.auth)).status).toBe(204);
  });
});

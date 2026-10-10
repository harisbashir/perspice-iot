import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarm, alarmEvent } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const threshold = (scope: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'Low fuel',
  severity: 'major',
  scope,
  type: 'threshold',
  condition: { key: 'fuel_level', op: '<', value: 20 },
  clear: { margin: 2 },
  channels: ['inapp', 'email'],
  ...extra,
});

describe('alarm rule API', () => {
  let t: TestApp;
  let platform: string;
  let platformUserId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformUserId = p.id;
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant(roleKey: 'customer_admin' | 'customer_viewer' = 'customer_admin') {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey, customerId: c.id });
    const profile = await createProfile(t.db);
    const { device } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Site' });
    return { c, u, profile, device, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  const create = (auth: string, body: object) => t.http.post('/api/alarm-rules').set('Authorization', auth).send(body);

  it('platform admins create, update and delete profile rules; deleting clears open alarms', async () => {
    const a = await tenant();
    const res = await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'threshold', version: 1, enabled: true, recipients: { roles: [], userIds: [], groupIds: [] } });
    const id = res.body.id as string;

    const upd = await t.http
      .put(`/api/alarm-rules/${id}`)
      .set('Authorization', platform)
      .send(threshold({ kind: 'profile', profileId: a.profile.id }, { severity: 'critical' }));
    expect(upd.body).toMatchObject({ severity: 'critical', version: 2 });

    const [open] = await t.db
      .insert(alarm)
      .values({ ruleId: id, ruleName: 'Low fuel', type: 'threshold', deviceId: a.device.id, customerId: a.c.id, severity: 'critical', startedAt: new Date() })
      .returning();
    expect((await t.http.delete(`/api/alarm-rules/${id}`).set('Authorization', platform)).status).toBe(204);
    expect(await t.db.query.alarm.findFirst({ where: eq(alarm.id, open!.id) })).toMatchObject({ status: 'cleared', clearReason: 'rule_removed' });
    expect(await t.db.query.alarmEvent.findFirst({ where: eq(alarmEvent.alarmId, open!.id) })).toMatchObject({ type: 'cleared' });
  });

  it('customer admins write rules only for their own customer and devices (Review Focus 2)', async () => {
    const a = await tenant();
    const b = await tenant();
    const colleague = await createUser(t.db, { roleKey: 'customer_operator', customerId: a.c.id });

    const own = await create(a.auth, threshold({ kind: 'customer', customerId: a.c.id }, { recipients: { userIds: [colleague.id] } }));
    expect(own.status).toBe(201);
    expect((await create(a.auth, threshold({ kind: 'device', deviceId: a.device.id }))).status).toBe(201);

    expect((await create(a.auth, threshold({ kind: 'customer', customerId: b.c.id }))).status).toBe(404);
    expect((await create(a.auth, threshold({ kind: 'device', deviceId: b.device.id }))).status).toBe(404);
    expect((await create(a.auth, threshold({ kind: 'profile', profileId: a.profile.id }))).status).toBe(403);
    // Recipients must belong to the rule's tenant.
    const foreign = await create(a.auth, threshold({ kind: 'customer', customerId: a.c.id }, { recipients: { userIds: [b.u.id] } }));
    expect(foreign.status).toBe(400);
    const platformRecipient = await create(a.auth, threshold({ kind: 'device', deviceId: a.device.id }, { recipients: { userIds: [platformUserId] } }));
    expect(platformRecipient.status).toBe(400);

    // Viewers can read but not write.
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: a.c.id });
    const vAuth = `Bearer ${await tokenFor(t, viewer.email, viewer.password, `${a.c.slug}.localhost`)}`;
    expect((await t.http.get('/api/alarm-rules').set('Authorization', vAuth)).status).toBe(200);
    expect((await create(vAuth, threshold({ kind: 'device', deviceId: a.device.id }))).status).toBe(403);
  });

  it('platform profile rules use platform users as explicit recipients', async () => {
    const a = await tenant();
    const bad = await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { recipients: { userIds: [a.u.id] } }));
    expect(bad.status).toBe(400);
    const ok = await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { recipients: { userIds: [platformUserId], roles: ['customer_admin'] } }));
    expect(ok.status).toBe(201);
  });

  it('resolves the effective rules of a device, honouring opt-outs', async () => {
    const a = await tenant();
    const other = await createProfile(t.db);
    const p1 = (await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { name: 'P1' }))).body;
    const p2 = (await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { name: 'P2' }))).body;
    await create(platform, threshold({ kind: 'profile', profileId: other.id }, { name: 'Other profile' }));
    await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { name: 'Off', enabled: false }));
    const optOut = await create(a.auth, threshold({ kind: 'device', deviceId: a.device.id }, { name: 'No P2 here', disablesRuleId: p2.id }));
    expect(optOut.status).toBe(201);
    await create(a.auth, threshold({ kind: 'customer', customerId: a.c.id }, { name: 'C all' }));
    await create(a.auth, threshold({ kind: 'customer', customerId: a.c.id, profileId: other.id }, { name: 'C other profile' }));
    await create(a.auth, threshold({ kind: 'device', deviceId: a.device.id }, { name: 'D1' }));

    const res = await t.http.get(`/api/devices/${a.device.id}/alarm-rules/effective`).set('Authorization', a.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { name: string }) => r.name).sort()).toEqual(['C all', 'D1', 'P1']);
    expect(res.body.find((r: { name: string }) => r.name === 'P1')).toMatchObject({ id: p1.id, origin: 'profile' });
  });

  it('shows customers the inherited profile rules without platform recipients', async () => {
    const a = await tenant();
    const rule = (await create(platform, threshold({ kind: 'profile', profileId: a.profile.id }, { recipients: { userIds: [platformUserId], roles: ['customer_admin'] } }))).body;
    const list = await t.http.get('/api/alarm-rules').set('Authorization', a.auth);
    const seen = list.body.find((r: { id: string }) => r.id === rule.id);
    expect(seen.recipients).toEqual({ roles: ['customer_admin'], userIds: [], groupIds: [] });
    // Visible, but managed by the platform.
    expect((await t.http.put(`/api/alarm-rules/${rule.id}`).set('Authorization', a.auth).send(threshold({ kind: 'profile', profileId: a.profile.id }))).status).toBe(403);
    expect((await t.http.delete(`/api/alarm-rules/${rule.id}`).set('Authorization', a.auth)).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { alarm, device } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectSocket, nextEvent } from '../socket-helpers';

const lowFuel = { type: 'threshold', condition: { key: 'fuel_level', op: '<', value: 20 }, clear: { margin: 2 } };

describe('alarm API', () => {
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

  /** A customer with operator/viewer users, a device with a token, and a low-fuel profile rule. */
  async function tenant() {
    const c = await createCustomer(t.db);
    const host = `${c.slug}.localhost`;
    const op = await createUser(t.db, { roleKey: 'customer_operator', customerId: c.id });
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    const profile = await createProfile(t.db);
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower' });
    const rule = await t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Low fuel', severity: 'critical', scope: { kind: 'profile', profileId: profile.id }, ...lowFuel });
    return {
      c,
      device,
      token,
      ruleId: rule.body.id as string,
      opToken: await tokenFor(t, op.email, op.password, host),
      viewerAuth: `Bearer ${await tokenFor(t, viewer.email, viewer.password, host)}`,
      get opAuth() {
        return `Bearer ${this.opToken}`;
      },
    };
  }

  const send = (token: string, values: Record<string, unknown>) =>
    t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values }).expect(202);

  async function waitForAlarms(auth: string, query: string, n: number) {
    for (let i = 0; i < 100; i++) {
      const res = await t.http.get(`/api/alarms?${query}`).set('Authorization', auth);
      if (res.body.items?.length >= n) return res.body.items;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('alarm did not appear');
  }

  it('walks the lifecycle with a timeline: active → acknowledged → cleared', async () => {
    const a = await tenant();
    await send(a.token, { fuel_level: 12 });
    const [listed] = await waitForAlarms(a.opAuth, 'status=active', 1);
    expect(listed).toMatchObject({ severity: 'critical', status: 'active', device: { id: a.device.id, name: 'Tower' }, customer: null, ruleName: 'Low fuel' });

    const ack = await t.http.post(`/api/alarms/${listed.id}/ack`).set('Authorization', a.opAuth).send({ comment: 'On my way' });
    expect(ack.body).toMatchObject({ status: 'acknowledged', acknowledgedBy: { name: expect.any(String) } });
    expect((await t.http.post(`/api/alarms/${listed.id}/ack`).set('Authorization', a.opAuth).send({})).status).toBe(409);
    expect((await t.http.post(`/api/alarms/${listed.id}/comments`).set('Authorization', a.opAuth).send({ comment: 'Refuelled' })).status).toBe(201);

    await send(a.token, { fuel_level: 80 });
    let detail = { status: '' } as { status: string; clearReason: string; timeline: { type: string; comment: string | null }[] };
    for (let i = 0; i < 100 && detail.status !== 'cleared'; i++) {
      detail = (await t.http.get(`/api/alarms/${listed.id}`).set('Authorization', a.opAuth)).body;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(detail).toMatchObject({ status: 'cleared', clearReason: 'condition' });
    expect(detail.timeline.map((e) => [e.type, e.comment])).toEqual([
      ['raised', null],
      ['acknowledged', 'On my way'],
      ['comment', 'Refuelled'],
      ['cleared', null],
    ]);
    expect((await t.http.post(`/api/alarms/${listed.id}/clear`).set('Authorization', a.opAuth).send({})).status).toBe(409);
  });

  it('clears by hand straight from active, and the rule raises again while the condition holds', async () => {
    const a = await tenant();
    await send(a.token, { fuel_level: 5 });
    const [first] = await waitForAlarms(a.opAuth, 'status=active', 1);
    const cleared = await t.http.post(`/api/alarms/${first.id}/clear`).set('Authorization', a.opAuth).send({ comment: 'Sensor fault' });
    expect(cleared.body).toMatchObject({ status: 'cleared', clearReason: 'manual' });
    await send(a.token, { fuel_level: 5 });
    const again = await waitForAlarms(a.opAuth, 'status=active', 1);
    expect(again[0].id).not.toBe(first.id);
  });

  it('lets viewers read but not act, and keeps tenants apart (Review Focus 2)', async () => {
    const a = await tenant();
    const b = await tenant();
    await send(a.token, { fuel_level: 1 });
    await send(b.token, { fuel_level: 1 });
    const [mine] = await waitForAlarms(a.viewerAuth, '', 1);
    const [theirs] = await waitForAlarms(b.viewerAuth, '', 1);
    expect((await t.http.post(`/api/alarms/${mine.id}/ack`).set('Authorization', a.viewerAuth).send({})).status).toBe(403);

    expect((await t.http.get(`/api/alarms/${theirs.id}`).set('Authorization', a.opAuth)).status).toBe(404);
    expect((await t.http.post(`/api/alarms/${theirs.id}/ack`).set('Authorization', a.opAuth).send({})).status).toBe(404);
    const list = await t.http.get('/api/alarms').set('Authorization', a.opAuth);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    expect((await t.http.get('/api/alarms/summary').set('Authorization', a.opAuth)).body).toMatchObject({ critical: 1, total: 1, unacknowledged: 1 });

    // Platform users see both, with the customer.
    const all = await t.http.get(`/api/alarms?customerId=${b.c.id}`).set('Authorization', platform);
    expect(all.body.items).toMatchObject([{ id: theirs.id, customer: { id: b.c.id } }]);
  });

  it('pushes alarm changes to the tenant room only', async () => {
    const a = await tenant();
    const b = await tenant();
    const url = await t.baseUrl();
    const sa = await connectSocket(url, a.opToken);
    const sb = await connectSocket(url, b.opToken);
    try {
      expect(await sa.emitWithAck('subscribe:alarms')).toEqual({ ok: true });
      await sb.emitWithAck('subscribe:alarms');
      const got = nextEvent<{ change: string; deviceId: string }>(sa, 'alarm');
      const leaked = nextEvent(sb, 'alarm', 800).then(() => true, () => false);
      await send(a.token, { fuel_level: 3 });
      expect(await got).toMatchObject({ change: 'raised', deviceId: a.device.id });
      expect(await leaked).toBe(false);
    } finally {
      sa.close();
      sb.close();
    }
  });

  it('exports alarms', async () => {
    const a = await tenant();
    await send(a.token, { fuel_level: 2 });
    await waitForAlarms(a.opAuth, '', 1);
    const res = await t.http
      .post('/api/exports')
      .set('Authorization', a.opAuth)
      .send({ kind: 'alarms', format: 'csv', params: {} })
      .buffer(true)
      .parse((r, cb) => {
        let s = '';
        r.on('data', (c: Buffer) => (s += c.toString()));
        r.on('end', () => cb(null, s));
      });
    expect(res.status).toBe(200);
    const lines = (res.body as string).trim().split('\n');
    expect(lines[0]).toBe('Started (UTC),Severity,Status,Device,Rule,Message,Acknowledged (UTC),Acknowledged by,Cleared (UTC)');
    expect(lines[1]).toContain(',critical,active,Tower,Low fuel,fuel_level is 2 (< 20),,,');
    expect(await t.db.select().from(alarm)).not.toHaveLength(0);
  });

  it('serves the alarms data source within scope, per device and as counts (Review Focus 2)', async () => {
    const a = await tenant();
    const b = await tenant();
    const { device: second, token: secondToken } = await createDevice(t.db, { profileId: (await t.db.query.device.findFirst({ where: eq(device.id, a.device.id) }))!.profileId, customerId: a.c.id, name: 'Tower 2' });
    await send(a.token, { fuel_level: 1 });
    await send(secondToken, { fuel_level: 1 });
    await send(b.token, { fuel_level: 1 });
    await waitForAlarms(a.opAuth, '', 2);
    const query = (auth: string, deviceId: string | undefined, filter: object, mode: string) =>
      t.http
        .post('/api/dashboards/data')
        .set('Authorization', auth)
        .send({ deviceId, requests: [{ widgetId: 'w', datasource: { kind: 'alarms', filter, pageSize: 10 }, mode }] })
        .then((r) => r.body.results.w);

    const list = await query(a.opAuth, undefined, {}, 'list');
    expect(list.data.total).toBe(2);
    expect(list.data.alarms.map((x: { device: { name: string } }) => x.device.name).sort()).toEqual(['Tower', 'Tower 2']);
    const own = await query(a.opAuth, second.id, { currentDeviceOnly: true }, 'list');
    expect(own.data.alarms.map((x: { device: { id: string } }) => x.device.id)).toEqual([second.id]);
    // Another tenant's device id as "the dashboard's device" yields nothing.
    expect((await query(a.opAuth, b.device.id, { currentDeviceOnly: true }, 'list')).data.total).toBe(0);
    expect((await query(a.opAuth, undefined, {}, 'stats')).data).toMatchObject({ critical: 2, total: 2, unacknowledged: 2 });
  });
});

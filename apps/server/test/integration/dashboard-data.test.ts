import type { DataRequest } from '@perspice/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telemetry, telemetryLatest } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const H = 3_600_000;

describe('dashboard data API', () => {
  let t: TestApp;
  let platformAuth: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function customer() {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    return { c, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  async function latest(deviceId: string, values: Record<string, number>) {
    const ts = Date.now();
    for (const [k, v] of Object.entries(values)) {
      await t.redis.hset(`latest:${deviceId}`, k, JSON.stringify({ ts, v }));
      await t.db.insert(telemetryLatest).values({ deviceId, key: k, ts: new Date(ts), valueNum: v }).onConflictDoNothing();
    }
  }

  const query = (auth: string, body: { deviceId?: string; requests: Partial<DataRequest>[] }) =>
    t.http.post('/api/dashboards/data').set('Authorization', auth).send(body);

  it('serves latest values for the current device', async () => {
    const { c, auth } = await customer();
    const p = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: p.id, customerId: c.id, name: 'Tower' });
    await latest(d.id, { fuel_level: 64.5, batt_v: 52 });
    const res = await query(auth, {
      deviceId: d.id,
      requests: [{ widgetId: 'w1', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, mode: 'latest' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.w1).toMatchObject({ ok: true, data: { device: { id: d.id, name: 'Tower' }, values: { fuel_level: { v: 64.5 } } } });
    expect(res.body.results.w1.data.values.batt_v).toBeUndefined();
  });

  it("refuses another tenant's device per widget while other widgets succeed (Review Focus 1)", async () => {
    const a = await customer();
    const b = await customer();
    const p = await createProfile(t.db);
    const { device: own } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id });
    const { device: foreign } = await createDevice(t.db, { profileId: p.id, customerId: b.c.id });
    const res = await query(a.auth, {
      requests: [
        { widgetId: 'mine', datasource: { kind: 'device', deviceId: own.id, keys: ['x'] }, mode: 'latest' },
        { widgetId: 'theirs', datasource: { kind: 'device', deviceId: foreign.id, keys: ['x'] }, mode: 'latest' },
        { widgetId: 'theirs-history', datasource: { kind: 'device', deviceId: foreign.id, keys: ['x'] }, mode: 'history' },
      ],
    });
    expect(res.body.results.mine.ok).toBe(true);
    expect(res.body.results.theirs).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(res.body.results['theirs-history']).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    // A foreign current device fails every currentDevice widget the same way.
    const cur = await query(a.auth, {
      deviceId: foreign.id,
      requests: [{ widgetId: 'w', datasource: { kind: 'currentDevice', keys: ['x'] }, mode: 'latest' }],
    });
    expect(cur.body.results.w).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('lists only in-scope devices of a profile shared by two customers, sorted by a key', async () => {
    const a = await customer();
    const b = await customer();
    const p = await createProfile(t.db);
    for (const [n, v] of [
      ['a1', 10],
      ['a2', 30],
      ['a3', 20],
    ] as const) {
      const { device } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id, name: n });
      await latest(device.id, { fuel_level: v });
    }
    await createDevice(t.db, { profileId: p.id, customerId: b.c.id, name: 'b1' });
    const res = await query(a.auth, {
      requests: [
        {
          widgetId: 'table',
          datasource: { kind: 'entityList', profileId: p.id, columns: ['name', 'status', 'fuel_level'], pageSize: 2 },
          mode: 'list',
          sort: { by: 'fuel_level', dir: 'desc' },
        },
      ],
    });
    const data = res.body.results.table.data;
    expect(data.total).toBe(3);
    expect(data.items.map((i: { name: string }) => i.name)).toEqual(['a2', 'a3']);
    expect(data.items[0].values.fuel_level.v).toBe(30);

    const page2 = await query(a.auth, {
      requests: [
        {
          widgetId: 'table',
          datasource: { kind: 'entityList', profileId: p.id, columns: ['name'], pageSize: 2 },
          mode: 'list',
          page: 1,
          sort: { by: 'name', dir: 'asc' },
        },
      ],
    });
    expect(page2.body.results.table.data.items.map((i: { name: string }) => i.name)).toEqual(['a3']);
  });

  it('filters entity lists by customer, with a customer facet for platform viewers only', async () => {
    const a = await customer();
    const b = await customer();
    const p = await createProfile(t.db);
    await createDevice(t.db, { profileId: p.id, customerId: a.c.id, name: 'a1' });
    await createDevice(t.db, { profileId: p.id, customerId: b.c.id, name: 'b1' });
    const list = (auth: string, customerId?: string) =>
      query(auth, {
        requests: [{ widgetId: 't', datasource: { kind: 'entityList', profileId: p.id, columns: ['name', 'customer'], pageSize: 25 }, mode: 'list', customerId }],
      }).then((r) => r.body.results.t.data);

    const all = await list(platformAuth);
    expect(all.total).toBe(2);
    expect(all.customers.map((c: { id: string }) => c.id).sort()).toEqual([a.c.id, b.c.id].sort());
    const onlyB = await list(platformAuth, b.c.id);
    expect(onlyB.items.map((i: { name: string }) => i.name)).toEqual(['b1']);
    expect(onlyB.customers).toHaveLength(2); // the facet ignores the customer filter itself

    // A customer filtering on another customer just gets nothing, and no facet.
    const own = await list(a.auth);
    expect(own.customers).toBeUndefined();
    expect((await list(a.auth, b.c.id)).total).toBe(0);
  });

  it('serves located devices for maps, within scope, with their popup values', async () => {
    const a = await customer();
    const b = await customer();
    const p = await createProfile(t.db, { locationMode: 'fixed' });
    const { device: located } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id, name: 'Yard 1', location: { lat: 51.5, lng: -0.12, ts: 1, source: 'fixed' } });
    await createDevice(t.db, { profileId: p.id, customerId: a.c.id, name: 'Nowhere' });
    await createDevice(t.db, { profileId: p.id, customerId: b.c.id, name: 'Foreign', location: { lat: 48.8, lng: 2.3, ts: 1, source: 'fixed' } });
    // A newer reported position in Redis wins over the stored one.
    await t.redis.set(`loc:${located.id}`, JSON.stringify({ lat: 51.6, lng: -0.1, ts: 2, source: 'reported' }));
    await latest(located.id, { fuel_level: 40 });
    const res = await query(a.auth, {
      deviceId: located.id,
      requests: [
        { widgetId: 'map', datasource: { kind: 'devicesOfProfile', profileId: p.id, filter: {}, keys: ['fuel_level'] }, mode: 'locations' },
        { widgetId: 'one', datasource: { kind: 'currentDevice', keys: [] }, mode: 'locations' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map).toEqual({
      ok: true,
      data: {
        truncated: false,
        devices: [expect.objectContaining({ id: located.id, name: 'Yard 1', location: expect.objectContaining({ lat: 51.6, lng: -0.1 }), values: { fuel_level: expect.objectContaining({ v: 40 }) } })],
      },
    });
    expect(res.body.results.one.data.devices.map((d: { id: string }) => d.id)).toEqual([located.id]);
  });

  it('computes fleet stats within scope', async () => {
    const a = await customer();
    const b = await customer();
    const p = await createProfile(t.db);
    const { device: on } = await createDevice(t.db, { profileId: p.id, customerId: a.c.id, status: 'online' });
    await createDevice(t.db, { profileId: p.id, customerId: a.c.id, status: 'offline' });
    await createDevice(t.db, { profileId: p.id, customerId: b.c.id, status: 'online' });
    const now = Date.now();
    await t.db.insert(telemetry).values(
      Array.from({ length: 5 }, (_, i) => ({ deviceId: on.id, key: 'fuel_level', ts: new Date(now - i * 60_000), valueNum: i })),
    );
    const res = await query(a.auth, {
      requests: [{ widgetId: 'kpi', datasource: { kind: 'devicesOfProfile', profileId: null, keys: [] }, mode: 'stats' }],
    });
    expect(res.body.results.kpi.data).toEqual({ total: 2, online: 1, offline: 1, dead: 0, never: 0, messages24h: 5 });
  });

  it('serves history with automatic aggregation', async () => {
    const p = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: p.id });
    const end = Math.floor(Date.now() / H) * H - 2 * H;
    await t.db.insert(telemetry).values(Array.from({ length: 48 }, (_, h) => ({ deviceId: d.id, key: 'v', ts: new Date(end - h * H), valueNum: h })));
    await t.db.insert(telemetryLatest).values({ deviceId: d.id, key: 'v', ts: new Date(end), valueNum: 0 });
    const res = await query(platformAuth, {
      deviceId: d.id,
      requests: [
        {
          widgetId: 'chart',
          datasource: { kind: 'currentDevice', keys: ['v'] },
          mode: 'history',
          timewindow: { kind: 'absolute', fromMs: end - 7 * 24 * H, toMs: end + H },
        },
      ],
    });
    expect(res.body.results.chart.data.source).toBe('1h');
    expect(res.body.results.chart.data.series.v).toHaveLength(48);
  });

  it('reports configuration errors per widget and validates the request', async () => {
    const res = await query(platformAuth, {
      requests: [
        { widgetId: 'nodevice', datasource: { kind: 'currentDevice', keys: ['x'] }, mode: 'latest' },
        { widgetId: 'badmode', datasource: { kind: 'entityList', profileId: null, columns: ['name'], pageSize: 5 }, mode: 'history' },
      ],
    });
    expect(res.body.results.nodevice).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(res.body.results.badmode).toMatchObject({ ok: false, code: 'VALIDATION' });
    const tooMany = Array.from({ length: 61 }, (_, i) => ({ widgetId: `w${i}`, datasource: { kind: 'none' as const }, mode: 'latest' as const }));
    expect((await query(platformAuth, { requests: tooMany })).status).toBe(400);
  });
});

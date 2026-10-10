import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarm, telemetry } from '../../src/db/schema';
import { TelemetryStore } from '../../src/ingest/telemetry-store';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const definition = {
  states: [{ id: 'main', name: 'Site', layout: [{ i: 'w', x: 0, y: 0, w: 4, h: 4 }], widgets: [{ id: 'w', type: 'kpi', datasource: { kind: 'currentAsset', keys: [] }, settings: {} }] }],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
};

describe('asset dashboards', () => {
  let t: TestApp;
  let platform: string;
  let profileId: string;
  let typeId: string;
  let templateId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db, { telemetrySchema: [{ key: 'fuel', label: 'Fuel', unit: '%', type: 'number' }] })).id;
    typeId = (await t.http.post('/api/asset-types').set('Authorization', platform).send({ name: 'Site' })).body.id;
    const tpl = await t.http.post('/api/dashboard-templates').set('Authorization', platform).send({ name: 'Site dashboard', kind: 'asset', assetTypeId: typeId, definition });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    templateId = tpl.body.id;
    expect(tpl.body).toMatchObject({ kind: 'asset', assetTypeId: typeId, profileId: null });
    const set = await t.http.patch(`/api/asset-types/${typeId}`).set('Authorization', platform).send({ defaultDashboardTemplateId: templateId });
    expect(set.body.defaultDashboardTemplateId).toBe(templateId);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant() {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    return { c, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  it('validates asset templates and type defaults', async () => {
    expect((await t.http.post('/api/dashboard-templates').set('Authorization', platform).send({ name: 'X', kind: 'asset', definition })).status).toBe(400);
    expect((await t.http.post('/api/dashboard-templates').set('Authorization', platform).send({ name: 'X', kind: 'asset', assetTypeId: typeId, profileId, definition })).status).toBe(400);
    const deviceTpl = await t.http.post('/api/dashboard-templates').set('Authorization', platform).send({ name: 'Dev', kind: 'device', profileId, definition });
    expect((await t.http.patch(`/api/asset-types/${typeId}`).set('Authorization', platform).send({ defaultDashboardTemplateId: deviceTpl.body.id })).status).toBe(400);
  });

  it("serves the asset type's dashboard, and widgets read the asset's devices", async () => {
    const a = await tenant();
    const b = await tenant();
    const site = (await t.http.post('/api/assets').set('Authorization', a.auth).send({ name: 'Site 4', typeId })).body;
    const room = (await t.http.post('/api/assets').set('Authorization', a.auth).send({ name: 'Room', typeId, parentId: site.id })).body;
    const onSite = await createDevice(t.db, { profileId, customerId: a.c.id, name: 'On site', status: 'online' });
    const inRoom = await createDevice(t.db, { profileId, customerId: a.c.id, name: 'In room', status: 'offline' });
    const unrelated = await createDevice(t.db, { profileId, customerId: a.c.id, name: 'Elsewhere' });
    await t.http.put(`/api/devices/${onSite.device.id}/asset`).set('Authorization', a.auth).send({ assetId: site.id });
    await t.http.put(`/api/devices/${inRoom.device.id}/asset`).set('Authorization', a.auth).send({ assetId: room.id });
    for (const [d, v] of [
      [onSite, 40],
      [inRoom, 70],
      [unrelated, 10],
    ] as const) {
      await t.http.post('/api/v1/device/telemetry').set('x-device-token', d.token).send({ values: { fuel: v } });
    }

    const view = await t.http.get(`/api/dashboards/asset/${site.id}`).set('Authorization', a.auth);
    expect(view.body).toMatchObject({ templateId, templateName: 'Site dashboard', definition });
    expect((await t.http.get(`/api/dashboards/asset/${site.id}`).set('Authorization', b.auth)).status).toBe(404);

    const now = Date.now();
    await t.db.insert(telemetry).values([
      { deviceId: onSite.device.id, key: 'energy_used', ts: new Date(now - 60_000), valueNum: 2 },
      { deviceId: inRoom.device.id, key: 'energy_used', ts: new Date(now - 60_000), valueNum: 3 },
      { deviceId: unrelated.device.id, key: 'energy_used', ts: new Date(now - 60_000), valueNum: 100 },
    ]);
    await t.db.insert(alarm).values([
      { ruleId: null, ruleName: 'Room alarm', type: 'threshold', deviceId: inRoom.device.id, customerId: a.c.id, severity: 'major', startedAt: new Date(), message: 'x' },
      { ruleId: null, ruleName: 'Other alarm', type: 'threshold', deviceId: unrelated.device.id, customerId: a.c.id, severity: 'major', startedAt: new Date(), message: 'y' },
    ]);
    await t.app.get(TelemetryStore).writer.flush();
    const res = await t.http
      .post('/api/dashboards/data')
      .set('Authorization', a.auth)
      .send({
        assetId: site.id,
        requests: [
          { widgetId: 'all', datasource: { kind: 'currentAsset', keys: ['fuel'] }, mode: 'latest' },
          { widgetId: 'direct', datasource: { kind: 'currentAsset', depth: 'children', keys: ['fuel'] }, mode: 'latest' },
          { widgetId: 'stats', datasource: { kind: 'currentAsset', keys: [] }, mode: 'stats' },
          { widgetId: 'table', datasource: { kind: 'currentAsset', keys: ['fuel'] }, mode: 'list' },
          { widgetId: 'energy', datasource: { kind: 'currentAsset', keys: ['energy_used'] }, mode: 'energy', energyRange: 'window', timewindow: { kind: 'relative', lastMs: 3_600_000 * 3 } },
          { widgetId: 'alarms', datasource: { kind: 'alarms', filter: { currentAssetOnly: true } }, mode: 'list' },
        ],
      });
    expect(res.status).toBe(200);
    const r = res.body.results;
    expect(r.all.data.devices.map((d: { name: string; values: { fuel: { v: number } } }) => [d.name, d.values.fuel.v])).toEqual([
      ['In room', 70],
      ['On site', 40],
    ]);
    expect(r.direct.data.devices.map((d: { name: string }) => d.name)).toEqual(['On site']);
    expect(r.stats.data).toMatchObject({ total: 2, online: 2 }); // both reported, so both are online
    expect(r.table.data).toMatchObject({ total: 2 });
    expect(r.energy.data.total.consumption).toBe(5);
    expect(r.alarms.data.alarms.map((x: { ruleName: string }) => x.ruleName)).toEqual(['Room alarm']);

    // Another customer's asset: the widgets report not found, nothing leaks.
    const foreign = await t.http
      .post('/api/dashboards/data')
      .set('Authorization', b.auth)
      .send({ assetId: site.id, requests: [{ widgetId: 'all', datasource: { kind: 'currentAsset', keys: ['fuel'] }, mode: 'latest' }] });
    expect(foreign.body.results.all).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // Without an asset, the source says so.
    const none = await t.http.post('/api/dashboards/data').set('Authorization', a.auth).send({ requests: [{ widgetId: 'all', datasource: { kind: 'currentAsset', keys: [] }, mode: 'stats' }] });
    expect(none.body.results.all.ok).toBe(false);
  });
});

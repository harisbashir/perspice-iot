import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarm, device as deviceTable } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('assets', () => {
  let t: TestApp;
  let platform: string;
  let profileId: string;
  let siteType: { id: string };
  let roomType: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db)).id;
    siteType = (
      await t.http
        .post('/api/asset-types')
        .set('Authorization', platform)
        .send({ name: 'Site', icon: 'building', attributes: [{ key: 'address', label: 'Address', type: 'text' }, { key: 'kva', label: 'Supply', type: 'number' }] })
    ).body;
    roomType = (await t.http.post('/api/asset-types').set('Authorization', platform).send({ name: 'Generator room', icon: 'zap' })).body;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant() {
    const c = await createCustomer(t.db);
    const login = async (role: 'customer_admin' | 'customer_viewer', groupId?: string) => {
      const u = await createUser(t.db, { roleKey: role, customerId: c.id, ...(groupId ? { groupId } : {}) });
      return `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    };
    return { c, admin: await login('customer_admin'), viewer: await login('customer_viewer'), login };
  }

  const create = (auth: string, body: object) => t.http.post('/api/assets').set('Authorization', auth).send(body);

  describe('asset types', () => {
    it('are managed by the platform and read by customers', async () => {
      const a = await tenant();
      expect(siteType).toMatchObject({ name: 'Site', icon: 'building', assetCount: 0, defaultDashboardTemplateId: null });
      expect((await t.http.get('/api/asset-types').set('Authorization', a.viewer)).body.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['Site', 'Generator room']));
      expect((await t.http.post('/api/asset-types').set('Authorization', a.admin).send({ name: 'Mine' })).status).toBe(403);
    });

    it("can't be deleted while used", async () => {
      const a = await tenant();
      const type = (await t.http.post('/api/asset-types').set('Authorization', platform).send({ name: 'Temporary' })).body;
      const asset = (await create(a.admin, { name: 'X', typeId: type.id })).body;
      expect((await t.http.delete(`/api/asset-types/${type.id}`).set('Authorization', platform)).status).toBe(409);
      await t.http.delete(`/api/assets/${asset.id}`).set('Authorization', a.admin);
      expect((await t.http.delete(`/api/asset-types/${type.id}`).set('Authorization', platform)).status).toBe(204);
    });
  });

  describe('the hierarchy', () => {
    it('builds a tree within the customer, with breadcrumbs and validated attributes', async () => {
      const a = await tenant();
      const site = await create(a.admin, { name: 'Site 4', typeId: siteType.id, attributes: { address: 'Main St 1', kva: 250 }, location: { lat: 51.5, lng: -0.1 } });
      expect(site.status).toBe(201);
      expect(site.body).toMatchObject({ name: 'Site 4', typeName: 'Site', customerId: a.c.id, parentId: null, path: [] });
      const room = await create(a.admin, { name: 'Generator room', typeId: roomType.id, parentId: site.body.id });
      expect(room.body.path).toEqual([{ id: site.body.id, name: 'Site 4' }]);
      expect((await create(a.admin, { name: 'Bad', typeId: siteType.id, attributes: { colour: 'red' } })).status).toBe(400);
      expect((await create(a.admin, { name: 'Bad', typeId: siteType.id, attributes: { kva: 'lots' } })).status).toBe(400);

      const tree = await t.http.get('/api/assets/tree').set('Authorization', a.viewer);
      expect(tree.body.map((n: { name: string; parentId: string | null }) => [n.name, n.parentId])).toEqual(
        expect.arrayContaining([
          ['Site 4', null],
          ['Generator room', site.body.id],
        ]),
      );
      expect((await t.http.patch(`/api/assets/${site.body.id}`).set('Authorization', a.viewer).send({ name: 'X' })).status).toBe(403);
    });

    it('keeps customers apart', async () => {
      const a = await tenant();
      const b = await tenant();
      const theirs = (await create(b.admin, { name: 'B site', typeId: siteType.id })).body;
      expect((await t.http.get(`/api/assets/${theirs.id}`).set('Authorization', a.admin)).status).toBe(404);
      expect((await create(a.admin, { name: 'Under theirs', typeId: roomType.id, parentId: theirs.id })).status).toBe(404);
      // Naming another customer only creates in one's own.
      const mine = await create(a.admin, { name: 'Mine', typeId: siteType.id, customerId: b.c.id });
      expect(mine.body.customerId).toBe(a.c.id);
      expect((await t.http.get('/api/assets/tree').set('Authorization', a.admin)).body.map((n: { id: string }) => n.id)).not.toContain(theirs.id);
      // The platform names the customer.
      const forB = await create(platform, { name: 'Made for B', typeId: siteType.id, customerId: b.c.id });
      expect(forB.body.customerId).toBe(b.c.id);
      expect((await create(platform, { name: 'No customer', typeId: siteType.id })).status).toBe(400);
    });

    it('refuses loops, deep trees and deleting assets with sub-assets', async () => {
      const a = await tenant();
      const chain: { id: string }[] = [];
      for (let i = 0; i < 8; i++) chain.push((await create(a.admin, { name: `L${i}`, typeId: siteType.id, parentId: chain[i - 1]?.id ?? null })).body);
      expect((await create(a.admin, { name: 'Too deep', typeId: siteType.id, parentId: chain[7]!.id })).status).toBe(400);
      const loop = await t.http.patch(`/api/assets/${chain[0]!.id}`).set('Authorization', a.admin).send({ parentId: chain[3]!.id });
      expect(loop.status).toBe(400);
      expect(JSON.stringify(loop.body)).toContain('inside itself');
      expect((await t.http.patch(`/api/assets/${chain[0]!.id}`).set('Authorization', a.admin).send({ parentId: chain[0]!.id })).status).toBe(400);
      // Moving a subtree checks the depth of its deepest asset.
      const other = (await create(a.admin, { name: 'Other', typeId: siteType.id })).body;
      expect((await t.http.patch(`/api/assets/${chain[1]!.id}`).set('Authorization', a.admin).send({ parentId: other.id })).status).toBe(200);
      const deeper = (await create(a.admin, { name: 'Deeper', typeId: siteType.id, parentId: other.id })).body;
      expect((await t.http.patch(`/api/assets/${chain[1]!.id}`).set('Authorization', a.admin).send({ parentId: deeper.id })).status).toBe(400);
      expect((await t.http.delete(`/api/assets/${other.id}`).set('Authorization', a.admin)).status).toBe(409);
      expect((await t.http.delete(`/api/assets/${chain[7]!.id}`).set('Authorization', a.admin)).status).toBe(204);
    });
  });

  describe('devices', () => {
    it('attach to an asset of their customer, and roll up status and alarms', async () => {
      const a = await tenant();
      const b = await tenant();
      const site = (await create(a.admin, { name: 'Site', typeId: siteType.id })).body;
      const room = (await create(a.admin, { name: 'Room', typeId: roomType.id, parentId: site.id })).body;
      const d1 = (await createDevice(t.db, { profileId, customerId: a.c.id, status: 'online' })).device;
      const d2 = (await createDevice(t.db, { profileId, customerId: a.c.id, status: 'offline' })).device;
      const foreign = (await createDevice(t.db, { profileId, customerId: b.c.id })).device;
      const attach = (auth: string, deviceId: string, assetId: string | null) => t.http.put(`/api/devices/${deviceId}/asset`).set('Authorization', auth).send({ assetId });

      expect((await attach(a.admin, d1.id, site.id)).status).toBe(200);
      expect((await attach(a.admin, d2.id, room.id)).status).toBe(200);
      expect((await attach(a.admin, foreign.id, room.id)).status).toBe(404);
      expect((await attach(b.admin, foreign.id, room.id)).status).toBe(404);
      expect((await t.http.get(`/api/devices/${d2.id}/asset`).set('Authorization', a.viewer)).body).toEqual({
        asset: { id: room.id, name: 'Room', path: [{ id: site.id, name: 'Site' }] },
      });

      const direct = await t.http.get(`/api/assets/${site.id}/devices?depth=children`).set('Authorization', a.viewer);
      expect(direct.body.map((d: { id: string }) => d.id)).toEqual([d1.id]);
      const all = await t.http.get(`/api/assets/${site.id}/devices`).set('Authorization', a.viewer);
      expect(all.body.map((d: { id: string }) => d.id).sort()).toEqual([d1.id, d2.id].sort());

      await t.db.insert(alarm).values({ ruleId: null, ruleName: 'Hot', type: 'threshold', deviceId: d2.id, customerId: a.c.id, severity: 'major', startedAt: new Date(), message: 'hot' });
      const tree = (await t.http.get('/api/assets/tree').set('Authorization', a.admin)).body as { id: string; rollup: Record<string, unknown> }[];
      expect(tree.find((n) => n.id === site.id)!.rollup).toEqual({ devices: 2, online: 1, offline: 1, dead: 0, never: 0, alarms: 1, worstSeverity: 'major' });
      expect(tree.find((n) => n.id === room.id)!.rollup).toMatchObject({ devices: 1, offline: 1, alarms: 1 });

      // Detach; a device moved to another customer is detached too.
      expect((await attach(a.admin, d1.id, null)).status).toBe(200);
      expect((await t.http.get(`/api/devices/${d1.id}/asset`).set('Authorization', a.admin)).body).toEqual({ asset: null });
      await t.http.patch(`/api/devices/${d2.id}`).set('Authorization', platform).send({ customerId: b.c.id });
      expect((await t.http.get(`/api/devices/${d2.id}/asset`).set('Authorization', platform)).body).toEqual({ asset: null });
    });

    it('deleting an asset detaches its devices', async () => {
      const a = await tenant();
      const site = (await create(a.admin, { name: 'Site', typeId: siteType.id })).body;
      const d = (await createDevice(t.db, { profileId, customerId: a.c.id })).device;
      await t.http.put(`/api/devices/${d.id}/asset`).set('Authorization', a.admin).send({ assetId: site.id });
      expect((await t.http.delete(`/api/assets/${site.id}`).set('Authorization', a.admin)).status).toBe(204);
      expect(await t.db.query.device.findFirst({ where: eq(deviceTable.id, d.id) })).toBeTruthy();
      expect((await t.http.get(`/api/devices/${d.id}/asset`).set('Authorization', a.admin)).body).toEqual({ asset: null });
    });
  });

  it('group-limited users see only assets in their groups', async () => {
    const a = await tenant();
    const north = (await t.http.post(`/api/customers/${a.c.id}/groups`).set('Authorization', platform).send({ name: 'North' })).body;
    const inNorth = (await create(a.admin, { name: 'North site', typeId: siteType.id, groupId: north.id })).body;
    const elsewhere = (await create(a.admin, { name: 'South site', typeId: siteType.id })).body;
    const limited = await a.login('customer_viewer', north.id);
    const ids = (await t.http.get('/api/assets/tree').set('Authorization', limited)).body.map((n: { id: string }) => n.id);
    expect(ids).toEqual([inNorth.id]);
    expect((await t.http.get(`/api/assets/${elsewhere.id}`).set('Authorization', limited)).status).toBe(404);
    // A group from another customer is refused.
    const b = await tenant();
    const foreignGroup = (await t.http.post(`/api/customers/${b.c.id}/groups`).set('Authorization', platform).send({ name: 'X' })).body;
    expect((await create(a.admin, { name: 'Y', typeId: siteType.id, groupId: foreignGroup.id })).status).toBeGreaterThanOrEqual(400);
  });

  it('bulk attach, and filter devices and alarms by asset (subtree)', async () => {
    const a = await tenant();
    const b = await tenant();
    const site = (await create(a.admin, { name: 'Site', typeId: siteType.id })).body;
    const room = (await create(a.admin, { name: 'Room', typeId: roomType.id, parentId: site.id })).body;
    const theirs = (await create(b.admin, { name: 'B', typeId: siteType.id })).body;
    const [d1, d2, d3] = await Promise.all([1, 2, 3].map(async () => (await createDevice(t.db, { profileId, customerId: a.c.id })).device));
    const bulk = (assetId: string | null, ids: string[]) =>
      t.http.post('/api/devices/bulk').set('Authorization', a.admin).send({ deviceIds: ids, action: { kind: 'asset', assetId } });
    expect((await bulk(room.id, [d1!.id, d2!.id])).body.ok).toBe(2);
    const foreign = await bulk(theirs.id, [d3!.id]);
    expect(foreign.body).toMatchObject({ ok: 0, results: [{ ok: false, error: 'Not found' }] });

    const list = async (assetId: string) => (await t.http.get(`/api/devices?assetId=${assetId}`).set('Authorization', a.viewer)).body.items.map((d: { id: string }) => d.id).sort();
    expect(await list(site.id)).toEqual([d1!.id, d2!.id].sort()); // the site's subtree
    expect(await list(room.id)).toEqual([d1!.id, d2!.id].sort());

    await t.db.insert(alarm).values([
      { ruleId: null, ruleName: 'A', type: 'threshold', deviceId: d1!.id, customerId: a.c.id, severity: 'minor', startedAt: new Date(), message: 'a' },
      { ruleId: null, ruleName: 'B', type: 'threshold', deviceId: d3!.id, customerId: a.c.id, severity: 'minor', startedAt: new Date(), message: 'b' },
    ]);
    const alarms = await t.http.get(`/api/alarms?assetId=${site.id}`).set('Authorization', a.viewer);
    expect(alarms.body.items.map((x: { ruleName: string }) => x.ruleName)).toEqual(['A']);
    expect((await bulk(null, [d1!.id])).body.ok).toBe(1);
    expect(await list(site.id)).toEqual([d2!.id]);
  });
});

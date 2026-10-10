import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device } from '../../src/db/schema';
import { DEFAULT_MAP_TILES } from '@perspice/shared';
import { LocationService } from '../../src/location/location.service';
import { SettingsService } from '../../src/settings/settings.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectSocket, nextEvent } from '../socket-helpers';

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('device locations', () => {
  let t: TestApp;
  let admin: string;
  let otherCustomer: string;
  let acmeId: string;
  let acmeAdmin: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    admin = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const acme = await createCustomer(t.db);
    acmeId = acme.id;
    const a = await createUser(t.db, { roleKey: 'customer_admin', customerId: acme.id });
    acmeAdmin = await tokenFor(t, a.email, a.password, `${acme.slug}.localhost`);
    const beta = await createCustomer(t.db);
    const b = await createUser(t.db, { roleKey: 'customer_admin', customerId: beta.id });
    otherCustomer = `Bearer ${await tokenFor(t, b.email, b.password, `${beta.slug}.localhost`)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tracker(mode: 'reported' | 'fixed' | 'none' = 'reported') {
    const profile = await createProfile(t.db, {
      locationMode: mode,
      telemetrySchema: [
        { key: 'lat', label: 'Latitude', type: 'number' },
        { key: 'lng', label: 'Longitude', type: 'number' },
        { key: 'speed', label: 'Speed', unit: 'km/h', type: 'number' },
      ],
    });
    const { device: d, token } = await createDevice(t.db, { profileId: profile.id, customerId: acmeId });
    const send = (body: object) => t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send(body);
    return { id: d.id, send };
  }

  const getLocation = (id: string, auth = admin) => t.http.get(`/api/devices/${id}/location`).set('Authorization', auth);
  const locationOf = async (id: string) => (await getLocation(id)).body.location;

  it('takes reported fixes from telemetry and shows them on the device', async () => {
    const d = await tracker();
    const ts = Date.now() - 1000;
    expect((await d.send({ ts, values: { lat: 51.5074, lng: -0.1278, speed: 42, temp: 20 } })).status).toBe(202);
    const loc = await eventually(() => locationOf(d.id), (l) => !!l);
    expect(loc).toEqual({ lat: 51.5074, lng: -0.1278, speed: 42, ts, source: 'reported' });
    const dto = await t.http.get(`/api/devices/${d.id}`).set('Authorization', admin);
    expect(dto.body.location).toMatchObject({ lat: 51.5074, lng: -0.1278 });
  });

  it('keeps the newest fix by timestamp, and rejects invalid fixes into the debug log', async () => {
    const d = await tracker();
    const now = Date.now();
    await d.send({ ts: now - 1000, values: { lat: 10.5, lng: 20.5 } });
    await d.send({ ts: now - 5000, values: { lat: 11.5, lng: 21.5 } }); // older: ignored
    await d.send({ ts: now - 500, values: { lat: 0, lng: 0 } }); // no-fix 0,0: rejected
    await d.send({ ts: now - 400, values: { lat: 95, lng: 20 } }); // out of range: rejected
    const loc = await eventually(() => locationOf(d.id), (l) => l?.lat === 10.5);
    expect(loc).toMatchObject({ lat: 10.5, lng: 20.5, ts: now - 1000 });
    const debug = await t.http.get(`/api/devices/${d.id}/debug`).set('Authorization', admin);
    const rejected = (debug.body as { kind: string; summary: string }[]).filter((e) => e.kind === 'rejected');
    expect(rejected.map((e) => e.summary)).toEqual(expect.arrayContaining([expect.stringMatching(/location/i)]));
    expect(rejected).toHaveLength(2);
  });

  it('a message without both coordinates is not a fix', async () => {
    const d = await tracker();
    await d.send({ values: { lat: 10.5, speed: 3 } });
    await new Promise((r) => setTimeout(r, 300));
    expect(await locationOf(d.id)).toBeNull();
  });

  it('sets a fixed location by hand, and refuses it when the profile has no location', async () => {
    const d = await tracker('fixed');
    const put = await t.http.put(`/api/devices/${d.id}/location`).set('Authorization', admin).send({ lat: -33.86, lng: 151.21 });
    expect(put.status).toBe(200);
    expect(put.body.location).toMatchObject({ lat: -33.86, lng: 151.21, source: 'fixed' });
    expect(await locationOf(d.id)).toMatchObject({ lat: -33.86, lng: 151.21, source: 'fixed' });
    // Stored at once (not only in Redis).
    expect((await t.db.query.device.findFirst({ where: eq(device.id, d.id) }))!.location).toMatchObject({ lat: -33.86, source: 'fixed' });
    expect((await t.http.put(`/api/devices/${d.id}/location`).set('Authorization', admin).send({ lat: 0, lng: 0 })).status).toBe(400);
    expect((await t.http.delete(`/api/devices/${d.id}/location`).set('Authorization', admin)).status).toBe(204);
    expect(await locationOf(d.id)).toBeNull();

    const none = await tracker('none');
    expect((await t.http.put(`/api/devices/${none.id}/location`).set('Authorization', admin).send({ lat: 1, lng: 1 })).status).toBe(400);
  });

  it('writes reported locations to the database once the stored one is a minute behind', async () => {
    const d = await tracker();
    const location = t.app.get(LocationService);
    const stored = async () => (await t.db.query.device.findFirst({ where: eq(device.id, d.id) }))!.location;
    const base = Date.now() - 600_000;
    await d.send({ ts: base, values: { lat: 1.5, lng: 1.5 } });
    await eventually(() => locationOf(d.id), (l) => l?.lat === 1.5);
    await location.flush();
    expect(await stored()).toMatchObject({ lat: 1.5, ts: base });
    await d.send({ ts: base + 30_000, values: { lat: 1.6, lng: 1.5 } });
    await eventually(() => locationOf(d.id), (l) => l?.lat === 1.6);
    await location.flush();
    expect(await stored()).toMatchObject({ lat: 1.5 }); // only 30 s newer: kept pending
    await d.send({ ts: base + 61_000, values: { lat: 1.7, lng: 1.5 } });
    await eventually(() => locationOf(d.id), (l) => l?.lat === 1.7);
    await location.flush();
    expect(await stored()).toMatchObject({ lat: 1.7, ts: base + 61_000 });
    // Nothing left pending for this device.
    expect(await t.redis.hexists('loc:pending', d.id)).toBe(0);
  });

  it('returns the route over a time range, oldest first', async () => {
    const d = await tracker();
    const base = Date.now() - 60_000;
    await d.send([
      { ts: base, values: { lat: 51.5, lng: -0.12, speed: 10 } },
      { ts: base + 10_000, values: { lat: 51.501, lng: -0.12, speed: 20 } },
      { ts: base + 20_000, values: { lat: 51.502, lng: -0.121 } },
      { ts: base + 25_000, values: { temp: 3 } },
    ]);
    const res = await eventually(
      () => t.http.get(`/api/devices/${d.id}/route?from=${base - 1}&to=${base + 30_000}`).set('Authorization', admin),
      (r) => r.body?.points?.length === 3,
    );
    expect(res.body.points).toEqual([
      { ts: base, lat: 51.5, lng: -0.12, speed: 10 },
      { ts: base + 10_000, lat: 51.501, lng: -0.12, speed: 20 },
      { ts: base + 20_000, lat: 51.502, lng: -0.121 },
    ]);
    expect(res.body.downsampled).toBe(false);
  });

  it("another customer can't see or change a device's location or route", async () => {
    const d = await tracker('fixed');
    expect((await getLocation(d.id, otherCustomer)).status).toBe(404);
    expect((await t.http.get(`/api/devices/${d.id}/route`).set('Authorization', otherCustomer)).status).toBe(404);
    expect((await t.http.put(`/api/devices/${d.id}/location`).set('Authorization', otherCustomer).send({ lat: 1, lng: 1 })).status).toBe(404);
  });

  it('profiles carry the location mode and keys', async () => {
    const res = await t.http
      .post('/api/device-profiles')
      .set('Authorization', admin)
      .send({ name: 'Van', locationMode: 'reported', locationKeys: { lat: 'latitude', lng: 'longitude' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ locationMode: 'reported', locationKeys: { lat: 'latitude', lng: 'longitude', speed: 'speed', accuracy: 'acc' } });
  });

  it('streams new fixes to sockets subscribed to the device, and only to them', async () => {
    const d = await tracker();
    const other = await tracker();
    const base = await t.baseUrl();
    const socket = await connectSocket(base, acmeAdmin);
    try {
      expect(await socket.emitWithAck('subscribe:device', { deviceId: d.id })).toEqual({ ok: true });
      const got = nextEvent<{ deviceId: string; location: { lat: number } }>(socket, 'location', 3000);
      let foreign = false;
      socket.on('location', (e: { deviceId: string }) => {
        if (e.deviceId === other.id) foreign = true;
      });
      await other.send({ values: { lat: 2.5, lng: 2.5 } });
      await d.send({ values: { lat: 3.5, lng: 3.5 } });
      expect(await got).toMatchObject({ deviceId: d.id, location: { lat: 3.5, lng: 3.5, source: 'reported' } });
      await new Promise((r) => setTimeout(r, 200));
      expect(foreign).toBe(false);
    } finally {
      socket.close();
    }
  });

  describe('map tiles setting', () => {
    it('defaults to OpenStreetMap and is readable by any signed-in user', async () => {
      const res = await t.http.get('/api/settings/map').set('Authorization', `Bearer ${acmeAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 });
      expect(res.body.attribution).toContain('OpenStreetMap');
    });

    it('accepts tile servers the content security policy allows, and only from system admins', async () => {
      await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
      const su = await createUser(t.db, { roleKey: 'super_admin' });
      const superAuth = `Bearer ${await tokenFor(t, su.email, su.password)}`;
      expect((await t.http.put('/api/settings/map').set('Authorization', admin).send(DEFAULT_MAP_TILES)).status).toBe(403);
      const ok = { urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 18 };
      expect((await t.http.put('/api/settings/map').set('Authorization', `Bearer ${acmeAdmin}`).send(ok)).status).toBe(403);
      const put = await t.http.put('/api/settings/map').set('Authorization', superAuth).send(ok);
      expect(put.status).toBe(200);
      expect((await t.http.get('/api/settings/map').set('Authorization', admin)).body).toMatchObject(ok);
      const blocked = await t.http.put('/api/settings/map').set('Authorization', superAuth).send({ ...ok, urlTemplate: 'https://tiles.example.com/{z}/{x}/{y}.png' });
      expect(blocked.status).toBe(400);
      expect(JSON.stringify(blocked.body)).toContain('MAP_TILE_HOSTS');
      const noPlaceholders = await t.http.put('/api/settings/map').set('Authorization', superAuth).send({ ...ok, urlTemplate: 'https://tile.openstreetmap.org/tile.png' });
      expect(noPlaceholders.status).toBe(400);
      const plain = await t.http.put('/api/settings/map').set('Authorization', superAuth).send({ ...ok, urlTemplate: 'http://tile.openstreetmap.org/{z}/{x}/{y}.png' });
      expect(plain.status).toBe(400);
    });
  });
});

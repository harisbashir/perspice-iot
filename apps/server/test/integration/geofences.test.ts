import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const circle = (lat = 51.5, lng = -0.12, radiusM = 500) => ({ type: 'circle', center: { lat, lng }, radiusM });
const square = (lng = 10, lat = 50, d = 0.01) => ({
  type: 'polygon',
  coordinates: [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]],
});

describe('geofences', () => {
  let t: TestApp;
  let platform: string;
  let acme: { id: string; admin: string; viewer: string };
  let beta: { id: string; admin: string };

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const login = async (roleKey: 'customer_admin' | 'customer_viewer', c: { id: string; slug: string }) => {
      const u = await createUser(t.db, { roleKey, customerId: c.id });
      return `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    };
    const a = await createCustomer(t.db);
    const b = await createCustomer(t.db);
    acme = { id: a.id, admin: await login('customer_admin', a), viewer: await login('customer_viewer', a) };
    beta = { id: b.id, admin: await login('customer_admin', b) };
  });

  afterAll(async () => {
    await t?.close();
  });

  const create = (auth: string, body: object) => t.http.post('/api/geofences').set('Authorization', auth).send(body);
  const list = (auth: string, q = '') => t.http.get(`/api/geofences${q}`).set('Authorization', auth);

  it('a customer admin creates, edits and deletes their own geofences', async () => {
    const res = await create(acme.admin, { name: 'Depot', shape: circle() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Depot', customerId: acme.id, shape: circle(), color: '#2563eb' });
    const id = res.body.id as string;
    const patched = await t.http.patch(`/api/geofences/${id}`).set('Authorization', acme.admin).send({ name: 'Main depot', shape: square() });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Main depot', shape: square() });
    expect((await t.http.get(`/api/geofences/${id}`).set('Authorization', acme.admin)).body.name).toBe('Main depot');
    expect((await t.http.delete(`/api/geofences/${id}`).set('Authorization', acme.admin)).status).toBe(204);
    expect((await t.http.get(`/api/geofences/${id}`).set('Authorization', acme.admin)).status).toBe(404);
  });

  it('validates shapes', async () => {
    const open = { type: 'polygon', coordinates: [[10, 50], [10.01, 50], [10.01, 50.01]] };
    expect((await create(acme.admin, { name: 'Open', shape: open })).status).toBe(400);
    expect((await create(acme.admin, { name: 'Zero', shape: circle(51.5, -0.12, 0) })).status).toBe(400);
    expect((await create(acme.admin, { name: '', shape: circle() })).status).toBe(400);
  });

  it('keeps customers apart', async () => {
    const mine = (await create(acme.admin, { name: 'Acme yard', shape: circle() })).body;
    // A customer can't place a geofence in another customer.
    expect((await create(acme.admin, { name: 'Sneaky', shape: circle(), customerId: beta.id })).status).toBe(404);
    expect((await t.http.get(`/api/geofences/${mine.id}`).set('Authorization', beta.admin)).status).toBe(404);
    expect((await t.http.patch(`/api/geofences/${mine.id}`).set('Authorization', beta.admin).send({ name: 'x' })).status).toBe(404);
    expect((await t.http.delete(`/api/geofences/${mine.id}`).set('Authorization', beta.admin)).status).toBe(404);
    expect(((await list(beta.admin)).body as { id: string }[]).map((g) => g.id)).not.toContain(mine.id);
    // Platform users see every customer's geofences, and can filter by customer.
    expect(((await list(platform, `?customerId=${acme.id}`)).body as { id: string }[]).map((g) => g.id)).toContain(mine.id);
  });

  it('platform-wide geofences are visible to every customer but changed only by the platform', async () => {
    const shared = await create(platform, { name: 'Port area', shape: square(4, 51.9), customerId: null });
    expect(shared.status).toBe(201);
    expect(shared.body.customerId).toBeNull();
    for (const auth of [acme.admin, beta.admin]) {
      expect(((await list(auth)).body as { id: string }[]).map((g) => g.id)).toContain(shared.body.id);
    }
    expect((await t.http.patch(`/api/geofences/${shared.body.id}`).set('Authorization', acme.admin).send({ name: 'x' })).status).toBe(403);
    expect((await t.http.delete(`/api/geofences/${shared.body.id}`).set('Authorization', acme.admin)).status).toBe(403);
  });

  it('viewers can see geofences but not change them', async () => {
    await create(acme.admin, { name: 'Viewer test', shape: circle() });
    expect((await list(acme.viewer)).status).toBe(200);
    expect((await create(acme.viewer, { name: 'Nope', shape: circle() })).status).toBe(403);
  });

  it('filters by map area', async () => {
    const london = (await create(acme.admin, { name: 'London', shape: circle(51.5, -0.12, 1000) })).body;
    const paris = (await create(acme.admin, { name: 'Paris', shape: circle(48.86, 2.35, 1000) })).body;
    // A box around London (minLng,minLat,maxLng,maxLat).
    const res = await list(acme.admin, '?bbox=-0.5,51.3,0.3,51.7');
    const ids = (res.body as { id: string }[]).map((g) => g.id);
    expect(ids).toContain(london.id);
    expect(ids).not.toContain(paris.id);
    expect((await list(acme.admin, '?bbox=1,2,3')).status).toBe(400);
  });
});

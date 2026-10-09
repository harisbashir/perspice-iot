import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashboardTemplate, deviceProfile } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { sampleDefinition } from '../dashboard-fixtures';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('dashboard templates', () => {
  let t: TestApp;
  let auth: string;
  let profileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db, { name: 'RMS' })).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  const create = (body: Record<string, unknown> = {}) =>
    t.http
      .post('/api/dashboard-templates')
      .set('Authorization', auth)
      .send({ name: 'RMS dashboard', kind: 'device', profileId, definition: sampleDefinition(), ...body });

  it('creates and increments the version on definition changes only', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'device', profileId, version: 1, builtIn: false });
    const renamed = await t.http.patch(`/api/dashboard-templates/${res.body.id}`).set('Authorization', auth).send({ name: 'Renamed' });
    expect(renamed.body.version).toBe(1);
    const changed = await t.http
      .patch(`/api/dashboard-templates/${res.body.id}`)
      .set('Authorization', auth)
      .send({ definition: sampleDefinition(['batt_v']) });
    expect(changed.body.version).toBe(2);
  });

  it('validates the definition and kind/profile pairing', async () => {
    const bad = sampleDefinition();
    bad.states[0]!.layout = [];
    expect((await create({ definition: bad })).status).toBe(400);
    expect((await create({ kind: 'overview' })).status).toBe(400);
    expect((await create({ profileId: null })).status).toBe(400);
  });

  it('clones with a key mapping onto another profile', async () => {
    const src = await create();
    const other = await createProfile(t.db, { name: 'Other' });
    const res = await t.http
      .post(`/api/dashboard-templates/${src.body.id}/clone`)
      .set('Authorization', auth)
      .send({ name: 'Copy', profileId: other.id, keyMapping: { fuel_level: 'tank_pct' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Copy', profileId: other.id, version: 1 });
    expect(res.body.definition.states[0].widgets[0].datasource.keys).toEqual(['tank_pct']);
  });

  it('exports and imports templates as JSON', async () => {
    const src = await create();
    const exported = await t.http.get(`/api/dashboard-templates/${src.body.id}/export`).set('Authorization', auth);
    expect(exported.body).toMatchObject({ format: 'perspice-dashboard', version: 1, template: { name: 'RMS dashboard', kind: 'device' } });
    const imported = await t.http
      .post('/api/dashboard-templates/import')
      .set('Authorization', auth)
      .send({ envelope: exported.body, profileId });
    expect(imported.status).toBe(201);
    expect(imported.body.definition).toEqual(src.body.definition);
    const bad = await t.http
      .post('/api/dashboard-templates/import')
      .set('Authorization', auth)
      .send({ envelope: { format: 'other', template: {} }, profileId });
    expect(bad.status).toBe(400);
  });

  it('sets a device template as the profile default', async () => {
    const tpl = await create();
    const res = await t.http
      .put(`/api/device-profiles/${profileId}/default-dashboard`)
      .set('Authorization', auth)
      .send({ templateId: tpl.body.id });
    expect(res.status).toBe(200);
    const row = await t.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) });
    expect(row?.defaultDashboardTemplateId).toBe(tpl.body.id);
    const otherProfile = await createProfile(t.db);
    const mismatch = await t.http
      .put(`/api/device-profiles/${otherProfile.id}/default-dashboard`)
      .set('Authorization', auth)
      .send({ templateId: tpl.body.id });
    expect(mismatch.status).toBe(400);
  });

  it('built-in templates cannot be deleted', async () => {
    const tpl = await create();
    await t.db.update(dashboardTemplate).set({ builtIn: true }).where(eq(dashboardTemplate.id, tpl.body.id));
    expect((await t.http.delete(`/api/dashboard-templates/${tpl.body.id}`).set('Authorization', auth)).status).toBe(403);
  });

  it('customers cannot write templates and only see templates used by their dashboards', async () => {
    const tpl = await create();
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const cAuth = `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}`;
    expect((await t.http.get(`/api/dashboard-templates/${tpl.body.id}`).set('Authorization', cAuth)).status).toBe(404);
    expect((await t.http.post('/api/dashboard-templates').set('Authorization', cAuth).send({})).status).toBe(403);
    const list = await t.http.get('/api/dashboard-templates').set('Authorization', cAuth);
    expect(list.body).toEqual([]);
  });
});

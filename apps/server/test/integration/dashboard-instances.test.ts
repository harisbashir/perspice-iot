import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashboardInstance, dashboardTemplate } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { sampleDefinition } from '../dashboard-fixtures';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('dashboard instances', () => {
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

  /** A profile with a default template, and a customer with an admin and a viewer. */
  async function setup() {
    const profile = await createProfile(t.db);
    const tpl = await t.http
      .post('/api/dashboard-templates')
      .set('Authorization', platformAuth)
      .send({ name: 'Default', kind: 'device', profileId: profile.id, definition: sampleDefinition() });
    await t.http.put(`/api/device-profiles/${profile.id}/default-dashboard`).set('Authorization', platformAuth).send({ templateId: tpl.body.id });
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    const host = `${c.slug}.localhost`;
    return {
      profile,
      templateId: tpl.body.id as string,
      c,
      adminAuth: `Bearer ${await tokenFor(t, admin.email, admin.password, host)}`,
      viewerAuth: `Bearer ${await tokenFor(t, viewer.email, viewer.password, host)}`,
    };
  }

  const newDevice = async (profileId: string, customerId?: string) =>
    (await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'd', profileId, customerId })).body.device.id as string;

  const instancesFor = (templateId: string, customerId: string) =>
    t.db.select().from(dashboardInstance).where(and(eq(dashboardInstance.templateId, templateId), eq(dashboardInstance.customerId, customerId)));

  it('assigning devices creates exactly one instance per customer and profile template', async () => {
    const s = await setup();
    await newDevice(s.profile.id, s.c.id);
    await newDevice(s.profile.id, s.c.id);
    expect(await instancesFor(s.templateId, s.c.id)).toHaveLength(1);
  });

  it('reassigning a device to another customer creates that customer’s instance', async () => {
    const s = await setup();
    const id = await newDevice(s.profile.id);
    const other = await createCustomer(t.db);
    await t.http.patch(`/api/devices/${id}`).set('Authorization', platformAuth).send({ customerId: other.id });
    expect(await instancesFor(s.templateId, other.id)).toHaveLength(1);
  });

  it('serves the device dashboard to the customer with the template definition', async () => {
    const s = await setup();
    const id = await newDevice(s.profile.id, s.c.id);
    const res = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', s.viewerAuth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ templateId: s.templateId, templateVersion: 1, overridden: false, outdated: false });
    expect(res.body.definition).toEqual(sampleDefinition());
  });

  it('returns null when the profile has no dashboard', async () => {
    const profile = await createProfile(t.db);
    const id = await newDevice(profile.id);
    const res = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', platformAuth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dashboard: null });
  });

  it('customise keeps the override; template drift is flagged; re-sync discards it (Review Focus 2)', async () => {
    const s = await setup();
    const id = await newDevice(s.profile.id, s.c.id);
    const view = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', s.adminAuth);
    const custom = sampleDefinition(['batt_v']);
    const put = await t.http.put(`/api/dashboard-instances/${view.body.instanceId}/override`).set('Authorization', s.adminAuth).send({ definition: custom });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ overridden: true, baseVersion: 1, outdated: false });

    await t.http
      .patch(`/api/dashboard-templates/${s.templateId}`)
      .set('Authorization', platformAuth)
      .send({ definition: sampleDefinition(['mains_v']) });
    const after = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', s.adminAuth);
    expect(after.body).toMatchObject({ overridden: true, templateVersion: 2, baseVersion: 1, outdated: true });
    expect(after.body.definition).toEqual(custom);

    const resync = await t.http.delete(`/api/dashboard-instances/${view.body.instanceId}/override`).set('Authorization', s.adminAuth);
    expect(resync.body).toMatchObject({ overridden: false, templateVersion: 2 });
    expect(resync.body.definition.states[0].widgets[0].datasource.keys).toEqual(['mains_v']);
  });

  it('uncustomised instances follow template edits immediately', async () => {
    const s = await setup();
    const id = await newDevice(s.profile.id, s.c.id);
    await t.http.patch(`/api/dashboard-templates/${s.templateId}`).set('Authorization', platformAuth).send({ definition: sampleDefinition(['x']) });
    const res = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', s.viewerAuth);
    expect(res.body.definition.states[0].widgets[0].datasource.keys).toEqual(['x']);
  });

  it('viewers cannot customise; overrides are validated', async () => {
    const s = await setup();
    const id = await newDevice(s.profile.id, s.c.id);
    const view = await t.http.get(`/api/dashboards/device/${id}`).set('Authorization', s.viewerAuth);
    expect(
      (await t.http.put(`/api/dashboard-instances/${view.body.instanceId}/override`).set('Authorization', s.viewerAuth).send({ definition: sampleDefinition() })).status,
    ).toBe(403);
    const bad = sampleDefinition();
    bad.states = [];
    expect(
      (await t.http.put(`/api/dashboard-instances/${view.body.instanceId}/override`).set('Authorization', s.adminAuth).send({ definition: bad })).status,
    ).toBe(400);
  });

  it('serves the overview dashboard per portal', async () => {
    const [tpl] = await t.db
      .insert(dashboardTemplate)
      .values({ name: 'Overview', kind: 'overview', builtIn: true, definition: sampleDefinition() })
      .returning();
    const s = await setup();
    const platform = await t.http.get('/api/dashboards/overview').set('Authorization', platformAuth);
    const customer = await t.http.get('/api/dashboards/overview').set('Authorization', s.viewerAuth);
    expect(platform.body.templateId).toBe(tpl!.id);
    expect(customer.body.templateId).toBe(tpl!.id);
    expect(platform.body.instanceId).not.toBe(customer.body.instanceId);
    const platformInstance = await t.db
      .select()
      .from(dashboardInstance)
      .where(and(eq(dashboardInstance.templateId, tpl!.id), isNull(dashboardInstance.customerId)));
    expect(platformInstance).toHaveLength(1);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashboardTemplate, deviceProfile } from '../../src/db/schema';
import type { PdfRenderer } from '../../src/reports/pdf-renderer';
import { type RenderBinding, RenderTokens } from '../../src/reports/render-tokens';
import { ReportsService } from '../../src/reports/reports.service';
import { tokenFor } from '../auth-helpers';
import { sampleDefinition } from '../dashboard-fixtures';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const TW = { kind: 'relative', lastMs: 86_400_000 } as const;
const FAKE_PDF = Buffer.from('%PDF-1.7 fake report');

describe('dashboard PDF reports', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  /** A customer with an admin and two devices on a profile that has a default dashboard. */
  async function setup() {
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const profile = await createProfile(t.db);
    const [tpl] = await t.db
      .insert(dashboardTemplate)
      .values({ name: 'Site view', kind: 'device', profileId: profile.id, definition: sampleDefinition() })
      .returning();
    await t.db.update(deviceProfile).set({ defaultDashboardTemplateId: tpl!.id }).where(eq(deviceProfile.id, profile.id));
    const { device: x } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower X' });
    const { device: y } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower Y' });
    const host = `${c.slug}.localhost`;
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password, host)}`;
    const binding: RenderBinding = {
      userId: admin.id,
      actor: { kind: 'user', apiKeyId: null, scopeType: 'customer', customerId: c.id, groupId: null, permissions: ['device.read', 'telemetry.read'] },
      request: { deviceId: x.id, timewindow: TW },
    };
    return { c, admin, auth, host, x, y, binding };
  }

  const openSession = (rt: string) => t.http.post('/api/print/session').send({ rt });
  const printData = (session: string, requests: unknown[]) => t.http.post('/api/print/data').send({ session, requests });
  const w1 = (datasource: unknown = { kind: 'currentDevice', keys: ['fuel_level'] }) => ({ widgetId: 'w1', datasource, mode: 'latest' });

  it('queues a report, renders it through a render token and notifies the owner', async () => {
    const { auth, x } = await setup();
    const res = await t.http.post('/api/reports/dashboard').set('Authorization', auth).send({ deviceId: x.id, timewindow: TW });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ kind: 'report', format: 'pdf', status: 'queued', title: 'Tower X — Site view' });

    const seen: { url: string; title?: string; data?: unknown } = { url: '' };
    const renderer: PdfRenderer = {
      async render(url) {
        seen.url = url;
        const rt = new URL(url).searchParams.get('rt')!;
        const session = await openSession(rt);
        expect(session.status).toBe(200);
        seen.title = session.body.title;
        seen.data = (await printData(session.body.session, [w1()])).body.results.w1;
        return FAKE_PDF;
      },
    };
    await t.app.get(ReportsService).process(res.body.id, renderer);

    expect(seen.url).toMatch(/^http:\/\/localhost\/print\/dashboard\?rt=rt_/);
    expect(seen.title).toBe('Tower X — Site view');
    expect(seen.data).toMatchObject({ ok: true, data: { device: { id: x.id } } });
    const job = (await t.http.get(`/api/exports/${res.body.id}`).set('Authorization', auth)).body;
    expect(job.status).toBe('done');
    const file = await t.http.get(job.downloadUrl);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/tower-x-site-view-.*\.pdf/);
    const notes = (await t.http.get('/api/notifications').set('Authorization', auth)).body.items;
    expect(notes[0]).toMatchObject({ type: 'export.ready', link: `/exports/${res.body.id}` });
  });

  it('render tokens work once and expire after their TTL (Review Focus 5)', async () => {
    const { binding } = await setup();
    const tokens = t.app.get(RenderTokens);
    const rt = await tokens.issue(binding);
    expect((await openSession(rt)).status).toBe(200);
    expect((await openSession(rt)).status).toBe(404);

    const short = await tokens.issue(binding, 50);
    await new Promise((r) => setTimeout(r, 150));
    expect((await openSession(short)).status).toBe(404);
    expect((await openSession('rt_forged')).status).toBe(404);
    expect((await printData('rs_forged', [])).status).toBe(404);
  });

  it('a print session serves only the bound dashboard (Review Focus 5)', async () => {
    const { binding, x, y } = await setup();
    const rt = await t.app.get(RenderTokens).issue(binding);
    const { body } = await openSession(rt);
    expect(body).toMatchObject({ dashboard: { templateName: 'Site view' }, device: { id: x.id }, stateId: 'main', viewer: { scopeType: 'customer' } });

    // Pointing the dashboard's widget at another device, or asking for a widget it doesn't have, is refused.
    expect((await printData(body.session, [w1({ kind: 'device', deviceId: y.id, keys: ['fuel_level'] })])).status).toBe(400);
    expect((await printData(body.session, [{ ...w1(), widgetId: 'other' }])).status).toBe(400);
    const ok = await printData(body.session, [w1()]);
    expect(ok.status).toBe(200);
    expect(ok.body.results.w1.data.device.id).toBe(x.id);
  });

  it("refuses reports on another tenant's device and for users without export.data", async () => {
    const a = await setup();
    const b = await setup();
    const res = await t.http.post('/api/reports/dashboard').set('Authorization', a.auth).send({ deviceId: b.x.id, timewindow: TW });
    expect(res.status).toBe(404);
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: a.c.id });
    const vAuth = `Bearer ${await tokenFor(t, viewer.email, viewer.password, a.host)}`;
    expect((await t.http.post('/api/reports/dashboard').set('Authorization', vAuth).send({ deviceId: a.x.id, timewindow: TW })).status).toBe(403);
    expect((await t.http.post('/api/reports/dashboard').set('Authorization', a.auth).send({ timewindow: TW })).status).toBe(400);
  });

  it('a failed render marks the job failed and tells the owner', async () => {
    const { auth, x } = await setup();
    const res = await t.http.post('/api/reports/dashboard').set('Authorization', auth).send({ deviceId: x.id, timewindow: TW });
    await t.app.get(ReportsService).process(res.body.id, { render: () => Promise.reject(new Error('Chromium crashed')) });
    const job = (await t.http.get(`/api/exports/${res.body.id}`).set('Authorization', auth)).body;
    expect(job).toMatchObject({ status: 'failed', error: 'Chromium crashed', downloadUrl: null });
  });
});

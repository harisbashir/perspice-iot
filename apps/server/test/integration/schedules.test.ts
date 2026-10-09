import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, exportJob, reportSchedule, telemetry, user } from '../../src/db/schema';
import { SchedulesService } from '../../src/schedules/schedules.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, mailText, waitForMail } from '../mailpit';

const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

describe('scheduled reports', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function setup() {
    const c = await createCustomer(t.db);
    const owner = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const colleague = await createUser(t.db, { roleKey: 'customer_operator', customerId: c.id, email: unique('reports') });
    const profile = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower 5' });
    await t.db.insert(telemetry).values({ deviceId: d.id, key: 'fuel_level', ts: new Date(Date.now() - 3_600_000), valueNum: 42 });
    const auth = `Bearer ${await tokenFor(t, owner.email, owner.password, `${c.slug}.localhost`)}`;
    const body = {
      name: 'Daily fuel',
      target: { kind: 'telemetry', deviceId: d.id, keys: ['fuel_level'], format: 'csv' },
      timewindow: { kind: 'relative', lastMs: 86_400_000 },
      cadence: { kind: 'daily', time: '07:00' },
      timezone: 'UTC',
      recipients: [colleague.id],
    };
    return { c, owner, colleague, d, auth, body };
  }

  const create = (auth: string, body: object) => t.http.post('/api/report-schedules').set('Authorization', auth).send(body);

  it('validates targets and recipients within the owner’s tenant', async () => {
    const a = await setup();
    const b = await setup();
    const ok = await create(a.auth, a.body);
    expect(ok.status).toBe(201);
    expect(ok.body.nextRunAt).toBeGreaterThan(Date.now());
    expect((await create(a.auth, { ...a.body, recipients: [b.colleague.id] })).status).toBe(400);
    expect((await create(a.auth, { ...a.body, target: { ...a.body.target, deviceId: b.d.id } })).status).toBe(404);
    expect((await create(a.auth, { ...a.body, target: { kind: 'dashboard' } })).status).toBe(400);
    expect((await create(a.auth, { ...a.body, timewindow: { kind: 'absolute', fromMs: 0, toMs: 1 } })).status).toBe(400);
  });

  it('runs a scheduled export and emails recipients a working 7-day link', async () => {
    const a = await setup();
    const { body: s } = await create(a.auth, a.body);
    const run = await t.http.post(`/api/report-schedules/${s.id}/run`).set('Authorization', a.auth);
    expect(run.status).toBe(202);
    expect(run.body.lastRun).toMatchObject({ status: 'ok', jobId: expect.any(String) });

    const mail = await waitForMail(a.colleague.email, 20_000);
    expect(mail.Subject).toContain('Report: Tower 5 telemetry');
    const link = /https?:\/\/\S+\/api\/files\/exports\/\S+/.exec(await mailText(mail.ID))![0];
    const path = link.replace(/^https?:\/\/[^/]+/, '');
    const file = await t.http.get(path);
    expect(file.status).toBe(200);
    expect(file.text).toContain('Time (UTC),fuel_level');
    expect(Number(new URL(link).searchParams.get('exp')) * 1000 - Date.now()).toBeGreaterThan(6 * 86_400_000);

    const job = await t.db.query.exportJob.findFirst({ where: eq(exportJob.id, run.body.lastRun.jobId) });
    expect(job!.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6 * 86_400_000);
    const after = (await t.http.get('/api/report-schedules').set('Authorization', a.auth)).body[0];
    expect(after.lastRun).toMatchObject({ status: 'ok', message: 'Sent to 1 recipient' });
    // The owner isn't sent the usual "export ready" notification.
    expect((await t.http.get('/api/notifications').set('Authorization', a.auth)).body.items).toHaveLength(0);
  });

  it('skips runs whose owner is deactivated or can no longer see the device (Review Focus 5)', async () => {
    const svc = t.app.get(SchedulesService);
    const a = await setup();
    const { body: s1 } = await create(a.auth, a.body);
    const b = await setup();
    const { body: s2 } = await create(b.auth, b.body);
    const past = new Date(Date.now() - 1000);
    await t.db.update(reportSchedule).set({ nextRunAt: past }).where(eq(reportSchedule.id, s1.id));
    await t.db.update(reportSchedule).set({ nextRunAt: past }).where(eq(reportSchedule.id, s2.id));

    await t.db.update(user).set({ status: 'disabled' }).where(eq(user.id, a.owner.id));
    const other = await createCustomer(t.db);
    await t.db.update(device).set({ customerId: other.id }).where(eq(device.id, b.d.id));

    expect(await svc.runDue()).toBeGreaterThanOrEqual(2);
    const r1 = (await t.db.query.reportSchedule.findFirst({ where: eq(reportSchedule.id, s1.id) }))!;
    const r2 = (await t.db.query.reportSchedule.findFirst({ where: eq(reportSchedule.id, s2.id) }))!;
    expect(r1).toMatchObject({ lastStatus: 'skipped', lastMessage: 'The owner of this schedule is no longer active', lastJobId: null });
    expect(r2).toMatchObject({ lastStatus: 'skipped', lastMessage: 'The owner can no longer see this dashboard or device', lastJobId: null });
    // Both moved on to their next run.
    expect(r1.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(r2.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('runs a due schedule once even when two schedulers race', async () => {
    const svc = t.app.get(SchedulesService);
    const a = await setup();
    const { body: s } = await create(a.auth, a.body);
    await t.db.update(reportSchedule).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(reportSchedule.id, s.id));
    await Promise.all([svc.runDue(), svc.runDue(), svc.runDue()]);
    const jobs = await t.db.select().from(exportJob).where(eq(exportJob.userId, a.owner.id));
    expect(jobs).toHaveLength(1);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarmRule, customerGroup, deliveryLog, notification } from '../../src/db/schema';
import { Dispatcher } from '../../src/delivery/dispatcher';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, listMail, mailText, waitForMail } from '../mailpit';

const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const lowFuel = { type: 'threshold', condition: { key: 'fuel_level', op: '<', value: 20 }, clear: { margin: 2 } };

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('notification delivery', () => {
  let t: TestApp;
  let platform: string;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function setup(rule: Record<string, unknown> = {}, severity = 'major') {
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id, email: unique('admin') });
    const profile = await createProfile(t.db);
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower 9' });
    const res = await t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Low fuel', severity, scope: { kind: 'profile', profileId: profile.id }, ...lowFuel, recipients: { roles: ['customer_admin'] }, channels: ['inapp', 'email'], ...rule });
    expect(res.status).toBe(201);
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}`;
    return { c, admin, auth, profile, device, token, ruleId: res.body.id as string };
  }

  const send = (token: string, fuel: number) => t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: { fuel_level: fuel } }).expect(202);
  const logs = (userId: string) => t.db.select().from(deliveryLog).where(eq(deliveryLog.userId, userId));

  it('emails and notifies in-app when an alarm is raised and cleared', async () => {
    const s = await setup();
    await send(s.token, 10);
    const raised = await waitForMail(s.admin.email);
    expect(raised.Subject).toContain('major: Low fuel on Tower 9');
    expect(await mailText(raised.ID)).toMatch(new RegExp(`http://${s.c.slug}\\.localhost/alarms/[0-9a-f-]{36}`));
    const bell = await eventually(() => t.http.get('/api/notifications').set('Authorization', s.auth), (r) => r.body.items?.length > 0);
    expect(bell.body.items[0]).toMatchObject({ type: 'alarm.raised', severity: 'critical', link: expect.stringMatching(/^\/alarms\//) });

    await send(s.token, 50);
    const mail = await eventually(() => listMail(s.admin.email), (m) => m.length === 2);
    expect(mail.map((m) => m.Subject).join('|')).toContain('Cleared: Low fuel on Tower 9');
    expect((await logs(s.admin.id)).every((l) => l.status === 'sent')).toBe(true);
  });

  it('drops recipients outside the device’s tenant and outside a limited user’s groups (Review Focus 2)', async () => {
    const s = await setup();
    const other = await createCustomer(t.db);
    const outsider = await createUser(t.db, { roleKey: 'customer_admin', customerId: other.id });
    const [g] = await t.db.insert(customerGroup).values({ customerId: s.c.id, name: 'North' }).returning();
    const limited = await createUser(t.db, { roleKey: 'customer_admin', customerId: s.c.id, groupId: g!.id });
    // A hand-edited rule naming an outsider (the API would refuse this).
    await t.db.update(alarmRule).set({ recipients: { roles: ['customer_admin'], userIds: [outsider.id], groupIds: [] } }).where(eq(alarmRule.id, s.ruleId));
    await send(s.token, 5);
    await waitForMail(s.admin.email);
    await new Promise((r) => setTimeout(r, 500));
    expect(await logs(outsider.id)).toHaveLength(0);
    expect(await logs(limited.id)).toHaveLength(0); // the device is in no group
  });

  it('applies minimum severity and quiet hours, with a critical bypass', async () => {
    const quiet = { from: '00:00', to: '00:00' }; // all day
    const s = await setup();
    await t.http
      .put('/api/me/notification-preferences')
      .set('Authorization', s.auth)
      .send({ preferences: { minSeverity: 'critical' } })
      .expect(200);
    await send(s.token, 5);
    await eventually(() => logs(s.admin.id), (l) => l.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect((await logs(s.admin.id)).map((l) => l.channel)).toEqual(['inapp']);

    const crit = await setup({}, 'critical');
    await t.http.put('/api/me/notification-preferences').set('Authorization', crit.auth).send({ preferences: { quietHours: quiet, criticalBypassesQuietHours: true } }).expect(200);
    await send(crit.token, 5);
    const critLogs = await eventually(() => logs(crit.admin.id), (l) => l.length === 2 && l.every((d) => d.status === 'sent'));
    expect(critLogs.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(['email:sent', 'inapp:sent']);

    const held = await setup();
    await t.http.put('/api/me/notification-preferences').set('Authorization', held.auth).send({ preferences: { quietHours: quiet } }).expect(200);
    await send(held.token, 5);
    const l = await eventually(() => logs(held.admin.id), (x) => x.length === 2 && x.some((d) => d.channel === 'inapp' && d.status === 'sent'));
    expect(l.find((d) => d.channel === 'email')).toMatchObject({ status: 'held' });
  });

  it('limits repeat notifications with the cooldown and skips clears of unannounced alarms (Review Focus 1)', async () => {
    const s = await setup({ cooldownS: 600, channels: ['inapp'] });
    for (const v of [5, 50, 5, 50, 5]) {
      await send(s.token, v);
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 500));
    const types = (await t.db.select().from(notification).where(eq(notification.userId, s.admin.id))).map((n) => n.type).sort();
    expect(types).toEqual(['alarm.cleared', 'alarm.raised']);
  });

  it('retries failed deliveries and marks them dead after 5 attempts', async () => {
    const s = await setup();
    const [row] = await t.db
      .insert(deliveryLog)
      .values({
        channel: 'email',
        userId: s.admin.id,
        customerId: s.c.id,
        recipient: s.admin.email,
        subject: 'Broken',
        payload: { message: { type: 'x', level: 'info', title: 'Broken', body: '', link: null, customerId: s.c.id }, recipient: { id: s.admin.id, email: s.admin.email, name: 'A', scopeType: 'customer', customerId: s.c.id, customerSlug: s.c.slug, timezone: 'UTC' } },
      })
      .returning();
    const dispatcher = t.app.get(Dispatcher);
    for (let i = 0; i < 5; i++) await dispatcher.run(row!.id).catch(() => undefined);
    expect(await t.db.query.deliveryLog.findFirst({ where: eq(deliveryLog.id, row!.id) })).toMatchObject({ status: 'dead', attempts: 5, error: 'No email template for x' });
    await dispatcher.run(row!.id); // dead deliveries are left alone
  });

  it('reads and saves preferences and timezone', async () => {
    const s = await setup();
    const get = await t.http.get('/api/me/notification-preferences').set('Authorization', s.auth);
    expect(get.body).toMatchObject({ timezone: null, effectiveTimezone: 'UTC', preferences: { email: true, minSeverity: 'info' } });
    const put = await t.http.put('/api/me/notification-preferences').set('Authorization', s.auth).send({ timezone: 'Asia/Karachi', preferences: { push: false } });
    expect(put.body).toMatchObject({ timezone: 'Asia/Karachi', effectiveTimezone: 'Asia/Karachi', preferences: { push: false } });
    expect((await t.http.put('/api/me/notification-preferences').set('Authorization', s.auth).send({ timezone: 'Mars/Base', preferences: {} })).status).toBe(400);
    expect(await logs(s.admin.id)).toHaveLength(0);
  });

  it('sends a test notification on the channels the user switched on', async () => {
    const s = await setup();
    await t.http.put('/api/me/notification-preferences').set('Authorization', s.auth).send({ preferences: { minSeverity: 'critical', quietHours: { from: '00:00', to: '00:00' } } }).expect(200);
    const res = await t.http.post('/api/me/notification-preferences/test').set('Authorization', s.auth);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 2 }); // in-app and email (push needs VAPID keys)
    const mail = await waitForMail(s.admin.email);
    expect(mail.Subject).toContain('Test email');
  });

  it('lets platform admins set a customer timezone, used for its users by default', async () => {
    const s = await setup();
    const res = await t.http.patch(`/api/customers/${s.c.id}`).set('Authorization', platform).send({ timezone: 'Europe/Berlin' });
    expect(res.body).toMatchObject({ timezone: 'Europe/Berlin' });
    expect((await t.http.patch(`/api/customers/${s.c.id}`).set('Authorization', platform).send({ timezone: 'Nope/Nope' })).status).toBe(400);
    expect((await t.http.get('/api/me/notification-preferences').set('Authorization', s.auth)).body.effectiveTimezone).toBe('Europe/Berlin');
  });
});

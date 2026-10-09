import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryLog, notification } from '../../src/db/schema';
import { DigestJob } from '../../src/delivery/digest.job';
import { Dispatcher } from '../../src/delivery/dispatcher';
import { PreferencesService } from '../../src/delivery/preferences.service';
import { RecipientResolver } from '../../src/delivery/recipients';
import type { Message } from '../../src/delivery/types';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, listMail, mailText } from '../mailpit';

const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
const msg = (i: number, customerId: string): Message => ({
  type: 'alarm.raised',
  level: 'major',
  title: `Alarm ${i}`,
  body: `Body ${i}`,
  link: `/alarms/${i}`,
  customerId,
  email: { template: 'alarm_raised', vars: { severity: 'major', ruleName: `Rule ${i}`, deviceName: 'D', profileName: 'P', message: '', startedAt: '' } },
});

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('digests', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function recipient(tz?: string) {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id, email: unique('storm') });
    const prefs = t.app.get(PreferencesService);
    if (tz) await prefs.update(u.id, { timezone: tz, preferences: {} });
    return { c, u, r: (await t.app.get(RecipientResolver).self(u.id))! };
  }

  const count = async (userId: string, channel: string, status: string) =>
    (await t.db.select().from(deliveryLog).where(and(eq(deliveryLog.userId, userId), eq(deliveryLog.channel, channel as never), eq(deliveryLog.status, status as never)))).length;

  it('sends the first N, then one digest for the rest of a storm; in-app keeps everything (Review Focus 4)', async () => {
    const { c, u, r } = await recipient();
    const d = t.app.get(Dispatcher);
    const now = Date.now();
    for (let i = 0; i < 200; i++) await d.dispatch([r], msg(i, c.id), ['inapp', 'email'], now + i * 100);
    expect(await count(u.id, 'email', 'held')).toBe(190);
    const job = t.app.get(DigestJob);
    expect(await job.run(now + 60_000)).toBe(0); // still inside the 15-minute window
    expect(await job.run(now + 16 * 60_000)).toBe(1);
    expect(await count(u.id, 'email', 'held')).toBe(0);

    const mails = await eventually(() => listMail(u.email), (m) => m.length === 11);
    expect(mails).toHaveLength(11);
    const digest = mails.find((m) => m.Subject.includes('190 notifications'))!;
    const text = await mailText(digest.ID);
    expect(text).toContain('Alarm 10');
    expect(text).toContain('…and 140 more');
    const inapp = await eventually(() => t.db.select().from(notification).where(eq(notification.userId, u.id)), (n) => n.length === 200);
    expect(inapp).toHaveLength(200);
  });

  it('holds email during quiet hours in the user’s timezone and releases a digest when they end', async () => {
    const { c, u, r } = await recipient('Asia/Karachi'); // UTC+5, no DST
    const prefs = t.app.get(PreferencesService);
    const now = Date.UTC(2026, 9, 9, 18, 30); // 23:30 in Karachi
    await prefs.update(u.id, { preferences: { quietHours: { from: '23:00', to: '07:00' } } });
    const d = t.app.get(Dispatcher);
    for (let i = 0; i < 3; i++) await d.dispatch([r], msg(i, c.id), ['email'], now + i);
    expect(await count(u.id, 'email', 'held')).toBe(3);

    const job = t.app.get(DigestJob);
    expect(await job.run(Date.UTC(2026, 9, 10, 1, 0))).toBe(0); // 06:00 in Karachi: still quiet
    expect(await job.run(Date.UTC(2026, 9, 10, 2, 5))).toBe(1); // 07:05: released
    const mail = await eventually(() => listMail(u.email), (m) => m.length === 1);
    expect(mail[0]!.Subject).toContain('3 notifications');
  });
});

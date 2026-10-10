import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarm, alarmEvent, alarmRule, customer, device } from '../../src/db/schema';
import { createCustomer, createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('alarm tables', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function fixture() {
    const c = await createCustomer(t.db);
    const p = await createProfile(t.db);
    const { device: d } = await createDevice(t.db, { profileId: p.id, customerId: c.id });
    const [rule] = await t.db
      .insert(alarmRule)
      .values({
        name: 'Low fuel',
        scopeKind: 'profile',
        profileId: p.id,
        type: 'threshold',
        condition: { key: 'fuel_level', op: '<', value: 20 },
        severity: 'major',
        recipients: { roles: [], userIds: [], groupIds: [] },
        channels: ['inapp'],
      })
      .returning();
    const open = { ruleId: rule!.id, ruleName: 'Low fuel', type: 'threshold' as const, deviceId: d.id, customerId: c.id, severity: 'major' as const, startedAt: new Date() };
    return { c, d, rule: rule!, open };
  }

  it('allows one open alarm per rule and device (Review Focus 1)', async () => {
    const { open } = await fixture();
    const [first] = await t.db.insert(alarm).values(open).returning();
    const dup = await t.db.insert(alarm).values(open).onConflictDoNothing().returning();
    expect(dup).toHaveLength(0);

    // Once cleared, the next one may open.
    await t.db.update(alarm).set({ status: 'cleared', clearedAt: new Date() }).where(eq(alarm.id, first!.id));
    expect(await t.db.insert(alarm).values(open).onConflictDoNothing().returning()).toHaveLength(1);
  });

  it('keeps alarms when their rule is deleted and removes them with the device', async () => {
    const { d, rule, open } = await fixture();
    const [a] = await t.db.insert(alarm).values(open).returning();
    await t.db.insert(alarmEvent).values({ alarmId: a!.id, type: 'raised' });
    await t.db.delete(alarmRule).where(eq(alarmRule.id, rule.id));
    expect(await t.db.query.alarm.findFirst({ where: eq(alarm.id, a!.id) })).toMatchObject({ ruleId: null, ruleName: 'Low fuel' });
    await t.db.delete(device).where(eq(device.id, d.id));
    expect(await t.db.query.alarm.findFirst({ where: eq(alarm.id, a!.id) })).toBeUndefined();
    expect(await t.db.query.alarmEvent.findFirst({ where: eq(alarmEvent.alarmId, a!.id) })).toBeUndefined();
  });

  it('defaults customer timezones to UTC', async () => {
    const { c } = await fixture();
    expect((await t.db.query.customer.findFirst({ where: eq(customer.id, c.id) }))!.timezone).toBe('UTC');
  });
});

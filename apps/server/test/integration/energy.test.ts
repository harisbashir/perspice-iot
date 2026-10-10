import { calendarStart } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customer as customerTable, telemetry } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const H = 3_600_000;
const utc = (s: string) => Date.parse(`${s}Z`);

describe('energy and tariffs', () => {
  let t: TestApp;
  let platform: string;
  let profileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db, { name: 'Energy meter' })).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant(timezone = 'Europe/London') {
    const c = await createCustomer(t.db);
    await t.db.update(customerTable).set({ timezone }).where(eq(customerTable.id, c.id));
    const login = async (role: 'customer_admin' | 'customer_operator') => {
      const u = await createUser(t.db, { roleKey: role, customerId: c.id });
      return `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    };
    return { c, admin: await login('customer_admin'), operator: await login('customer_operator') };
  }

  /** Per-interval consumption rows, as a counter_delta key would store them. */
  async function usage(deviceId: string, points: [number, number][], key = 'energy_used') {
    await t.db.insert(telemetry).values(points.map(([ts, v]) => ({ deviceId, key, ts: new Date(ts), valueNum: v })));
  }

  const peak = { currency: 'GBP', defaultRate: 0.2, periods: [{ name: 'Peak', rate: 0.4, days: [1, 2, 3, 4, 5], from: 17, to: 21 }] };

  describe('tariffs', () => {
    it('customers inherit the platform default until they set their own', async () => {
      const a = await tenant();
      expect((await t.http.get('/api/tariff').set('Authorization', a.admin)).body).toEqual({ tariff: null });
      expect((await t.http.put('/api/tariff').set('Authorization', platform).send({ currency: 'EUR', defaultRate: 0.25 })).status).toBe(200);
      expect((await t.http.get('/api/tariff').set('Authorization', a.admin)).body.tariff).toMatchObject({ currency: 'EUR', defaultRate: 0.25, customerId: null, inherited: true });

      const put = await t.http.put('/api/tariff').set('Authorization', a.admin).send(peak);
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ ...peak, customerId: a.c.id, inherited: false });
      expect((await t.http.get('/api/tariff').set('Authorization', a.admin)).body.tariff).toMatchObject({ currency: 'GBP', inherited: false });
      expect((await t.http.get(`/api/tariff?customerId=${a.c.id}`).set('Authorization', platform)).body.tariff).toMatchObject({ currency: 'GBP' });

      expect((await t.http.delete('/api/tariff').set('Authorization', a.admin)).status).toBe(204);
      expect((await t.http.get('/api/tariff').set('Authorization', a.admin)).body.tariff).toMatchObject({ currency: 'EUR', inherited: true });
    });

    it("customers only manage their own; operators can't", async () => {
      const a = await tenant();
      const b = await tenant();
      // A customer naming another customer still only changes its own tariff.
      await t.http.put('/api/tariff').set('Authorization', a.admin).send({ ...peak, customerId: b.c.id });
      expect((await t.http.get(`/api/tariff?customerId=${b.c.id}`).set('Authorization', platform)).body.tariff.inherited).toBe(true);
      expect((await t.http.put('/api/tariff').set('Authorization', a.operator).send(peak)).status).toBe(403);
      expect((await t.http.get('/api/tariff').set('Authorization', a.operator)).status).toBe(200);
    });

    it('validates periods', async () => {
      const a = await tenant();
      const res = await t.http.put('/api/tariff').set('Authorization', a.admin).send({ ...peak, periods: [{ name: 'Bad', rate: 1, days: [1], from: 20, to: 18 }] });
      expect(res.status).toBe(400);
    });
  });

  describe('consumption', () => {
    it('sums per local day and prices each hour at its rate', async () => {
      const a = await tenant('Europe/London');
      await t.http.put('/api/tariff').set('Authorization', a.admin).send(peak);
      const { device } = await createDevice(t.db, { profileId, customerId: a.c.id });
      // Wednesday 2026-10-07, London UTC+1: 16:00, 17:30 (peak) and 23:30 local; Thursday 00:15 local.
      await usage(device.id, [
        [utc('2026-10-07T15:00:00'), 1],
        [utc('2026-10-07T16:30:00'), 1.5],
        [utc('2026-10-07T16:45:00'), 0.5],
        [utc('2026-10-07T22:30:00'), 2],
        [utc('2026-10-07T23:15:00'), 3],
      ]);
      const res = await t.http
        .get(`/api/devices/${device.id}/energy`)
        .query({ key: 'energy_used', from: utc('2026-10-06T23:00:00'), to: utc('2026-10-08T23:00:00'), period: 'day' })
        .set('Authorization', a.operator);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        key: 'energy_used',
        timezone: 'Europe/London',
        currency: 'GBP',
        period: 'day',
        periods: [
          { period: '2026-10-07', consumption: 5, cost: 1.4 }, // 1×0.2 + 2×0.4 + 2×0.2
          { period: '2026-10-08', consumption: 3, cost: 0.6 },
        ],
        total: { consumption: 8, cost: 2 },
      });
    });

    it("without a tariff there's no cost; another customer's device is not found", async () => {
      const a = await tenant('UTC');
      const b = await tenant();
      const { device } = await createDevice(t.db, { profileId, customerId: a.c.id });
      await t.db.delete(telemetry).where(eq(telemetry.deviceId, device.id));
      await usage(device.id, [[utc('2026-10-07T10:00:00'), 4]]);
      // The platform default from the first test applies (EUR 0.25); remove it for this check.
      await t.http.delete('/api/tariff').set('Authorization', platform);
      const q = { key: 'energy_used', from: utc('2026-10-07T00:00:00'), to: utc('2026-10-08T00:00:00'), period: 'hour' };
      const res = await t.http.get(`/api/devices/${device.id}/energy`).query(q).set('Authorization', a.admin);
      expect(res.body).toMatchObject({ currency: null, periods: [{ period: '2026-10-07T10:00', consumption: 4, cost: null }], total: { consumption: 4, cost: null } });
      expect((await t.http.get(`/api/devices/${device.id}/energy`).query(q).set('Authorization', b.admin)).status).toBe(404);
      expect((await t.http.get(`/api/devices/${device.id}/energy`).query({ ...q, from: 0, to: 500 * 86_400_000 }).set('Authorization', a.admin)).status).toBe(400);
    });

    it('serves the energy data mode: this month so far against the same point last month', async () => {
      const a = await tenant('UTC');
      await t.http.put('/api/tariff').set('Authorization', a.admin).send({ currency: 'USD', defaultRate: 0.5 });
      const { device } = await createDevice(t.db, { profileId, customerId: a.c.id });
      const now = Date.now();
      const start = calendarStart(now, 'UTC', 'month');
      const elapsed = now - start;
      // This month: 2 units; last month: 1 unit in the same elapsed span, 10 after it (not compared).
      const prevStart = calendarStart(start - H, 'UTC', 'month');
      await usage(device.id, [
        [start, 2],
        [prevStart, 1],
        ...(prevStart + elapsed + H < start ? [[prevStart + elapsed + H, 10] as [number, number]] : []),
      ]);
      const res = await t.http
        .post('/api/dashboards/data')
        .set('Authorization', a.admin)
        .send({ deviceId: device.id, requests: [{ widgetId: 'e', datasource: { kind: 'currentDevice', keys: ['energy_used'] }, mode: 'energy', energyRange: 'month' }] });
      expect(res.status).toBe(200);
      const data = res.body.results.e.data;
      expect(data).toMatchObject({ key: 'energy_used', currency: 'USD', period: 'day', total: { consumption: 2, cost: 1 }, previous: { consumption: 1, cost: 0.5 } });
    });
  });
});

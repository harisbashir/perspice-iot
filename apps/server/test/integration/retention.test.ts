import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telemetry } from '../../src/db/schema';
import { RetentionService } from '../../src/telemetry/retention';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const DAY = 86_400_000;

describe('history retention', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function deviceWith(retentionDays: number, ages: number[]) {
    const profile = await createProfile(t.db, { retentionDays });
    const { device } = await createDevice(t.db, { profileId: profile.id });
    const now = Date.now();
    await t.db.insert(telemetry).values(ages.map((age, i) => ({ deviceId: device.id, key: 'temp', ts: new Date(now - age - i), valueNum: 20 + i })));
    return device.id;
  }
  const rawAges = async (deviceId: string) =>
    (await t.db.select({ ts: telemetry.ts }).from(telemetry).where(eq(telemetry.deviceId, deviceId))).map((r) => Math.round((Date.now() - r.ts.getTime()) / DAY));

  it('deletes raw history older than each profile’s retention, keeping the summaries', async () => {
    const short = await deviceWith(7, [1 * DAY, 6 * DAY, 8 * DAY, 30 * DAY]);
    const long = await deviceWith(365, [1 * DAY, 30 * DAY]);
    // The aggregates were materialised long ago in a real installation.
    for (const view of ['telemetry_1m', 'telemetry_1h', 'telemetry_1d']) {
      await t.db.execute(sql.raw(`CALL refresh_continuous_aggregate('${view}', now() - interval '40 days', now() - interval '2 days')`));
    }

    const deleted = await t.app.get(RetentionService).run();
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect((await rawAges(short)).sort((a, b) => a - b)).toEqual([1, 6]);
    expect((await rawAges(long)).sort((a, b) => a - b)).toEqual([1, 30]);

    // The hour of the 30-day-old reading is still in the summaries.
    const hourly = await t.db.execute(sql`SELECT count(*)::int AS n FROM telemetry_1h WHERE device_id = ${short} AND bucket < now() - interval '20 days'`);
    expect(hourly.rows[0]).toMatchObject({ n: 1 });

    // A short chart further back than the retention reads the minute summaries instead of raw data.
    const from = Date.now() - 30 * DAY - 2 * 3_600_000;
    const res = await t.http.get(`/api/devices/${short}/telemetry`).query({ keys: 'temp', from, to: from + 4 * 3_600_000 }).set('Authorization', auth);
    expect(res.body.source).toBe('1m');
    expect(res.body.series.temp).toHaveLength(1);
  });

  it('never keeps less than the summaries need (four days), whatever the setting', async () => {
    const id = await deviceWith(1, [2 * DAY, 5 * DAY]);
    await t.app.get(RetentionService).run();
    expect(await rawAges(id)).toEqual([2]);
    const left = await t.db.select().from(telemetry).where(and(eq(telemetry.deviceId, id), eq(telemetry.key, 'temp')));
    expect(left).toHaveLength(1);
  });
});

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telemetry, telemetryLatest } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const H = 3_600_000;

describe('telemetry query API', () => {
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

  async function deviceWithRows(rows: { key: string; ts: number; num?: number; str?: string }[]) {
    const p = await createProfile(t.db);
    const { device } = await createDevice(t.db, { profileId: p.id });
    if (rows.length) {
      await t.db.insert(telemetry).values(
        rows.map((r) => ({
          deviceId: device.id,
          key: r.key,
          ts: new Date(r.ts),
          valueNum: r.num ?? null,
          valueStr: r.str ?? null,
        })),
      );
    }
    return device.id;
  }

  it('returns raw values in ascending order for short ranges', async () => {
    const now = Date.now();
    const id = await deviceWithRows(
      Array.from({ length: 100 }, (_, i) => ({ key: 'temp', ts: now - (100 - i) * 1000, num: i })),
    );
    const res = await t.http
      .get(`/api/devices/${id}/telemetry?keys=temp&from=${now - H}&to=${now}`)
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('raw');
    const series = res.body.series.temp as [number, number][];
    expect(series).toHaveLength(100);
    expect(series[0]).toEqual([now - 100_000, 0]);
    expect(series.map(([ts]) => ts)).toEqual([...series.map(([ts]) => ts)].sort((a, b) => a - b));
  });

  it('returns non-numeric raw values as stored', async () => {
    const now = Date.now();
    const id = await deviceWithRows([{ key: 'state', ts: now - 1000, str: 'running' }]);
    const res = await t.http.get(`/api/devices/${id}/telemetry?keys=state&from=${now - H}&to=${now}`).set('Authorization', auth);
    expect(res.body.series.state).toEqual([[now - 1000, 'running']]);
  });

  it('uses hourly aggregates for a week', async () => {
    const end = Math.floor(Date.now() / H) * H - 2 * H;
    const rows = [];
    for (let h = 0; h < 48; h++) {
      for (let m = 0; m < 4; m++) rows.push({ key: 'fuel', ts: end - h * H + m * 60_000, num: h + m });
    }
    const id = await deviceWithRows(rows);
    await t.db.execute(sql`CALL refresh_continuous_aggregate('telemetry_1h', NULL, NULL)`);
    const res = await t.http
      .get(`/api/devices/${id}/telemetry?keys=fuel&from=${end - 7 * 24 * H}&to=${end + H}`)
      .set('Authorization', auth);
    expect(res.body.source).toBe('1h');
    const series = res.body.series.fuel as [number, number][];
    expect(series).toHaveLength(48);
    // Bucket at `end` holds minutes 0..3 of hour 0: values 0,1,2,3 → avg 1.5.
    expect(series[series.length - 1]).toEqual([end, 1.5]);
  });

  it('supports explicit min/max aggregation', async () => {
    const end = Math.floor(Date.now() / H) * H - 2 * H;
    const id = await deviceWithRows([
      { key: 'v', ts: end, num: 1 },
      { key: 'v', ts: end + 1000, num: 9 },
    ]);
    const res = await t.http
      .get(`/api/devices/${id}/telemetry?keys=v&from=${end - H}&to=${end + H}&agg=max`)
      .set('Authorization', auth);
    expect(res.body.source).toBe('1m');
    expect(res.body.series.v).toEqual([[end, 9]]);
  });

  it('serves latest values from Redis with a database fallback, and lists keys', async () => {
    const now = Date.now();
    const id = await deviceWithRows([]);
    await t.db.insert(telemetryLatest).values({ deviceId: id, key: 'temp', ts: new Date(now), valueNum: 21 });
    const latest = await t.http.get(`/api/devices/${id}/telemetry/latest`).set('Authorization', auth);
    expect(latest.body).toEqual({ temp: { ts: now, v: 21 } });
    await t.redis.hset(`latest:${id}`, 'temp', JSON.stringify({ ts: now + 1, v: 22 }));
    expect((await t.http.get(`/api/devices/${id}/telemetry/latest`).set('Authorization', auth)).body).toEqual({
      temp: { ts: now + 1, v: 22 },
    });
    const keys = await t.http.get(`/api/devices/${id}/telemetry/keys`).set('Authorization', auth);
    expect(keys.body).toEqual([{ key: 'temp', ts: now }]);
  });

  it('validates the time range', async () => {
    const id = await deviceWithRows([]);
    const res = await t.http.get(`/api/devices/${id}/telemetry?keys=a&from=200&to=100`).set('Authorization', auth);
    expect(res.status).toBe(400);
  });
});

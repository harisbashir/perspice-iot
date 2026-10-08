import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('database', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('creates telemetry as a hypertable', async () => {
    const res = await t.db.execute<{ hypertable_name: string }>(
      sql`SELECT hypertable_name FROM timescaledb_information.hypertables`,
    );
    expect(res.rows.map((r) => r.hypertable_name)).toContain('telemetry');
  });

  it('drops duplicate (device_id, key, ts) rows', async () => {
    const profile = await createProfile(t.db);
    const { device } = await createDevice(t.db, { profileId: profile.id });
    const ts = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 2; i++) {
      await t.db.execute(
        sql`INSERT INTO telemetry (device_id, key, ts, value_num) VALUES (${device.id}, 'temp', ${ts}, 21.5)
            ON CONFLICT DO NOTHING`,
      );
    }
    const res = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM telemetry WHERE device_id = ${device.id}`,
    );
    expect(res.rows[0]?.n).toBe(1);
  });

  it('creates the continuous aggregates', async () => {
    const res = await t.db.execute<{ view_name: string }>(
      sql`SELECT view_name FROM timescaledb_information.continuous_aggregates`,
    );
    expect(res.rows.map((r) => r.view_name).sort()).toEqual(['telemetry_1d', 'telemetry_1h', 'telemetry_1m']);
  });

  it('reports ready when database and redis are reachable', async () => {
    const res = await t.http.get('/ready');
    expect(res.status).toBe(200);
  });
});

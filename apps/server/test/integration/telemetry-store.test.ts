import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, telemetry, telemetryLatest } from '../../src/db/schema';
import { INGEST_BUFFER_STREAM, TelemetryStore } from '../../src/ingest/telemetry-store';
import type { WriteRow } from '../../src/ingest/normalize';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const row = (deviceId: string, key: string, v: number, ts = Date.now()): WriteRow => ({ deviceId, key, ts, valueNum: v, valueStr: null, valueBool: null, valueJson: null });

describe('telemetry store', () => {
  let t: TestApp;
  let store: TelemetryStore;
  let profileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get(TelemetryStore);
    profileId = (await createProfile(t.db)).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  const stored = (deviceId: string) => t.db.select().from(telemetry).where(eq(telemetry.deviceId, deviceId));

  it("a deleted device's rows in a batch don't fail the other devices' rows", async () => {
    const live = (await createDevice(t.db, { profileId })).device;
    const gone = (await createDevice(t.db, { profileId })).device;
    await t.db.delete(device).where(eq(device.id, gone.id));
    await store.write([row(live.id, 'temp', 21), row(gone.id, 'temp', 99)]);
    expect((await stored(live.id)).map((r) => r.valueNum)).toEqual([21]);
    expect(await t.db.select().from(telemetryLatest).where(eq(telemetryLatest.deviceId, live.id))).toHaveLength(1);
    expect(await stored(gone.id)).toHaveLength(0);
  });

  it('a buffered batch that can never be written is dropped instead of blocking the ones behind it', async () => {
    const d = (await createDevice(t.db, { profileId })).device;
    await t.redis.del(INGEST_BUFFER_STREAM);
    // A row the database refuses outright (not a connection problem), then a good one.
    await t.redis.xadd(INGEST_BUFFER_STREAM, '*', 'rows', JSON.stringify([{ ...row(d.id, 'bad', 1), ts: 'not a time' }]));
    await t.redis.xadd(INGEST_BUFFER_STREAM, '*', 'rows', JSON.stringify([row(d.id, 'good', 2)]));
    await (store as unknown as { replay(): Promise<void> }).replay();
    expect((await stored(d.id)).map((r) => r.key)).toEqual(['good']);
    expect(await t.redis.xlen(INGEST_BUFFER_STREAM)).toBe(0);
  });
});

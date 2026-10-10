import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, telemetry } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('HTTP device transport', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function newDevice() {
    const p = await createProfile(t.db, { transport: 'http' });
    return createDevice(t.db, { profileId: p.id });
  }

  const rows = async (id: string) =>
    (await t.db.select({ n: sql<number>`count(*)::int` }).from(telemetry).where(eq(telemetry.deviceId, id)))[0]!.n;

  async function eventually(fn: () => Promise<boolean>, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  }

  it('accepts telemetry with a valid token and marks the device online', async () => {
    const { device: d, token } = await newDevice();
    const res = await t.http
      .post('/api/v1/device/telemetry')
      .set('X-Device-Token', token)
      .send([{ ts: Date.now() - 1000, values: { temp: 1 } }, { values: { temp: 2, door: false } }]);
    expect(res.status).toBe(202);
    expect(await eventually(async () => (await rows(d.id)) === 3)).toBe(true);
    const row = await t.db.query.device.findFirst({ where: eq(device.id, d.id) });
    expect(row?.status).toBe('online');
  });

  it('rejects a bad or missing token with 401', async () => {
    expect((await t.http.post('/api/v1/device/telemetry').set('X-Device-Token', 'pdt_nope').send({ values: { a: 1 } })).status).toBe(401);
    expect((await t.http.post('/api/v1/device/telemetry').send({ values: { a: 1 } })).status).toBe(401);
  });

  it('rejects a user access token on device endpoints', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password)}`;
    expect((await t.http.post('/api/v1/device/telemetry').set('Authorization', auth).send({ values: { a: 1 } })).status).toBe(401);
  });

  it('returns 400 with the reason for an invalid payload', async () => {
    const { token } = await newDevice();
    const res = await t.http.post('/api/v1/device/telemetry').set('X-Device-Token', token).send({ values: { 'a/b': 1 } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION', details: { reason: 'invalid_key' } });
  });

  it('limits each device to 60 requests per minute', async () => {
    const { token } = await newDevice();
    // Fixed one-minute windows: don't start the burst just before a window rolls over.
    const intoWindow = Date.now() % 60_000;
    if (intoWindow > 58_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 50));
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      statuses.push((await t.http.post('/api/v1/device/telemetry').set('X-Device-Token', token).send({ values: { n: i } })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 202)).toBe(true);
    const last = await t.http.post('/api/v1/device/telemetry').set('X-Device-Token', token).send({ values: { n: 1 } });
    expect(last.status).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects bodies over 64 KB with 413', async () => {
    const { token } = await newDevice();
    const big = { values: { blob: 'x'.repeat(70 * 1024) } };
    const res = await t.http.post('/api/v1/device/telemetry').set('X-Device-Token', token).send(big);
    expect(res.status).toBe(413);
  });

  it('stores client attributes and serves shared attributes as config', async () => {
    const { device: d, token } = await newDevice();
    const attr = await t.http.post('/api/v1/device/attributes').set('X-Device-Token', token).send({ fw: '2.0.0' });
    expect(attr.status).toBe(202);
    await t.db
      .update(device)
      .set({ attributes: sql`jsonb_set(${device.attributes}, '{shared}', '{"interval":15}'::jsonb)` })
      .where(eq(device.id, d.id));
    const cfg = await t.http.get('/api/v1/device/config').set('X-Device-Token', token);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toEqual({ interval: 15 });
    const row = await t.db.query.device.findFirst({ where: eq(device.id, d.id) });
    expect(row?.firmwareVersion).toBe('2.0.0');
  });
});

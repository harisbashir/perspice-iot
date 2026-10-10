import { haversineM } from '@perspice/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TelemetryStore } from '../../src/ingest/telemetry-store';
import { TripsService } from '../../src/location/trips.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const HOME = { lat: 51.5, lng: -0.12 };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lng: HOME.lng });

describe('trips', () => {
  let t: TestApp;
  let admin: string;
  let other: string;
  let acmeId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    admin = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const acme = await createCustomer(t.db, { timezone: 'Europe/London' });
    acmeId = acme.id;
    const beta = await createCustomer(t.db);
    const b = await createUser(t.db, { roleKey: 'customer_admin', customerId: beta.id });
    other = `Bearer ${await tokenFor(t, b.email, b.password, `${beta.slug}.localhost`)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function vehicle(trips: Record<string, unknown> = { enabled: true }) {
    const profile = await createProfile(t.db, { locationMode: 'reported', tripSettings: trips });
    const { device: d, token } = await createDevice(t.db, { profileId: profile.id, customerId: acmeId });
    const send = (body: object) => t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send(body);
    return { id: d.id, send };
  }

  /** Parked 3 fixes, 1.2 km north in 2 minutes (36 km/h), then parked 6 minutes. */
  function drive(start: number) {
    const parked = [0, 1, 2].map((i) => ({ ts: start + i * 10_000, values: { lat: north(0).lat, lng: north(0).lng } }));
    const moving = Array.from({ length: 12 }, (_, i) => ({ ts: start + 30_000 + i * 10_000, values: north((i + 1) * 100) }));
    const stopped = Array.from({ length: 36 }, (_, i) => ({ ts: start + 150_000 + i * 10_000, values: north(1200) }));
    return [...parked, ...moving, ...stopped];
  }

  const trips = (id: string, auth = admin) => t.http.get(`/api/devices/${id}/trips`).set('Authorization', auth);

  it('records a drive as one trip with its distance and speeds', async () => {
    const v = await vehicle();
    const start = Date.now() - 3_600_000;
    for (const m of drive(start)) await v.send(m);
    const res = await eventually(() => trips(v.id), (r) => r.body?.[0]?.endTs !== null && r.body?.length === 1);
    expect(res.body).toHaveLength(1);
    const trip = res.body[0];
    expect(trip).toMatchObject({ deviceId: v.id, startTs: start + 20_000, endTs: start + 140_000 });
    expect(Math.abs(trip.distanceM - 1200) / 1200).toBeLessThan(0.01);
    expect(trip.maxSpeedKmh).toBeCloseTo(36, 0);
    expect(trip.avgSpeedKmh).toBeCloseTo(36, 0);
    expect(trip.start.lat).toBeCloseTo(north(0).lat, 5);
    expect(trip.end.lat).toBeCloseTo(north(1200).lat, 5);
  });

  it('final figures count every stored fix, also fixes a tracker sent as one batch', async () => {
    const v = await vehicle();
    const start = Date.now() - 3_600_000;
    // Zigzag: 100 m north and 60 m east or west each 10 s.
    const zig = (i: number) => ({ lat: north((i + 1) * 100).lat, lng: HOME.lng + (i % 2 ? 60 : 0) / (111_195 * Math.cos((HOME.lat * Math.PI) / 180)) });
    const parked = [0, 1, 2].map((i) => ({ ts: start + i * 10_000, values: north(0) }));
    const moving = Array.from({ length: 12 }, (_, i) => ({ ts: start + 30_000 + i * 10_000, values: zig(i) }));
    const stopped = Array.from({ length: 36 }, (_, i) => ({ ts: start + 150_000 + i * 10_000, values: zig(11) }));
    const path = [north(0), ...moving.map((m) => m.values)];
    const expected = path.slice(1).reduce((sum, p, i) => sum + haversineM(path[i]!, p), 0);

    for (const m of [...parked, moving[0]!]) await v.send(m);
    await v.send(moving.slice(1)); // the rest of the drive, buffered offline and sent at once
    for (const m of stopped) await v.send(m);
    const ended = await eventually(() => trips(v.id), (r) => r.body?.[0]?.endTs !== null);
    // Live, only the newest fix of the batch was seen: a straight line, shorter than the zigzag.
    expect(ended.body[0].distanceM).toBeLessThan(expected * 0.9);
    await t.app.get(TelemetryStore).writer.flush();
    await t.app.get(TripsService).finalize(ended.body[0].id);
    const final = (await trips(v.id)).body[0];
    expect(Math.abs(final.distanceM - expected) / expected).toBeLessThan(0.01);
  });

  it('shows the trip under way, and the sweep closes it when the device goes silent', async () => {
    const v = await vehicle();
    const start = Date.now() - 60_000;
    for (const m of drive(start).slice(0, 8)) await v.send(m);
    // Wait until all eight fixes have been followed (the live distance reaches 500 m).
    const open = await eventually(() => trips(v.id), (r) => r.body?.length === 1 && Math.round(r.body[0].distanceM) === 500);
    expect(open.body[0]).toMatchObject({ endTs: null, startTs: start + 20_000 });
    await t.app.get(TelemetryStore).writer.flush(); // the recomputation reads stored fixes
    await t.app.get(TripsService).sweep(Date.now() + 600_000);
    const closed = await eventually(() => trips(v.id), (r) => r.body?.[0]?.endTs !== null);
    expect(closed.body[0].endTs).toBe(start + 70_000); // the last movement
    expect(closed.body[0].distanceM).toBeCloseTo(500, -1);
  });

  it('splits distance per day at midnight in the customer’s timezone', async () => {
    const v = await vehicle();
    // 23:58 London time on 1 July (BST, UTC+1) = 22:58 UTC.
    const start = Date.UTC(2026, 6, 1, 22, 58, 0);
    const msgs = [
      ...[0, 1].map((i) => ({ ts: start + i * 10_000, values: north(0) })),
      // 100 m every 10 s for 4 minutes: 2 minutes before midnight, 2 after.
      ...Array.from({ length: 24 }, (_, i) => ({ ts: start + 20_000 + i * 10_000, values: north((i + 1) * 100) })),
      ...Array.from({ length: 32 }, (_, i) => ({ ts: start + 260_000 + i * 10_000, values: north(2400) })),
    ];
    for (const m of msgs) await v.send(m);
    await eventually(() => trips(v.id), (r) => r.body?.[0]?.endTs !== null);
    const res = await t.http
      .get(`/api/devices/${v.id}/distance?from=${start - 3_600_000}&to=${start + 3_600_000}`)
      .set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Europe/London');
    const days = Object.fromEntries((res.body.days as { day: string; distanceM: number }[]).map((d) => [d.day, d.distanceM]));
    expect(Object.keys(days)).toEqual(['2026-07-01', '2026-07-02']);
    // Fixes up to 23:59:50 count on 1 July; the one at midnight starts 2 July.
    expect(days['2026-07-01']).toBeCloseTo(1000, -1);
    expect(days['2026-07-02']).toBeCloseTo(1400, -1);
    expect(days['2026-07-01']! + days['2026-07-02']!).toBeCloseTo(2400, -1);
  });

  it('with an ignition key, trips follow the ignition', async () => {
    const v = await vehicle({ enabled: true, ignitionKey: 'ignition' });
    const start = Date.now() - 3_600_000;
    await v.send({ ts: start, values: { ...north(0), ignition: false } });
    await v.send({ ts: start + 10_000, values: { ...north(0), ignition: true } });
    await v.send({ ts: start + 20_000, values: north(300) });
    await v.send({ ts: start + 30_000, values: { ignition: false } }); // no fix in this message
    const res = await eventually(() => trips(v.id), (r) => r.body?.[0]?.endTs !== null);
    expect(res.body[0]).toMatchObject({ startTs: start + 10_000, endTs: start + 30_000 });
    expect(res.body[0].distanceM).toBeCloseTo(300, -1);
  });

  it('records nothing when trips are off for the profile', async () => {
    const v = await vehicle({ enabled: false });
    for (const m of drive(Date.now() - 3_600_000)) await v.send(m);
    await new Promise((r) => setTimeout(r, 500));
    expect((await trips(v.id)).body).toEqual([]);
  });

  it("another customer can't see a device's trips or distance", async () => {
    const v = await vehicle();
    expect((await trips(v.id, other)).status).toBe(404);
    expect((await t.http.get(`/api/devices/${v.id}/distance`).set('Authorization', other)).status).toBe(404);
  });
});

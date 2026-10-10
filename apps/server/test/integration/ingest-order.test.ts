import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

const north = (m: number) => ({ lat: 51.5 + m / 111_195, lng: -0.12 });

describe('ingest keeps each device’s messages in order', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  });

  it('a burst of buffered positions over MQTT still makes one trip (Review Focus 2)', async () => {
    const c = await createCustomer(t.db);
    const profile = await createProfile(t.db, { locationMode: 'reported', tripSettings: { enabled: true } });
    const { device: d, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id });
    const client = await connectDevice(t, d.id, token);
    try {
      const start = Date.now() - 3_600_000;
      const msgs = [
        ...[0, 1, 2].map((i) => ({ ts: start + i * 10_000, values: north(0) })),
        ...Array.from({ length: 12 }, (_, i) => ({ ts: start + 30_000 + i * 10_000, values: north((i + 1) * 100) })),
        ...Array.from({ length: 36 }, (_, i) => ({ ts: start + 150_000 + i * 10_000, values: north(1200) })),
      ];
      // All at once, as a tracker sends what it buffered while out of coverage.
      await Promise.all(msgs.map((m) => client.publishAsync(`perspice/v1/${d.id}/telemetry`, JSON.stringify(m), { qos: 1 })));
      let trips: { endTs: number | null; distanceM: number }[] = [];
      for (let i = 0; i < 100 && !(trips.length && trips[0]!.endTs); i++) {
        trips = (await t.http.get(`/api/devices/${d.id}/trips?from=${start - 1}&to=${Date.now()}`).set('Authorization', auth)).body;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({ startTs: start + 20_000, endTs: start + 140_000 });
      expect(Math.abs(trips[0]!.distanceM - 1200) / 1200).toBeLessThan(0.01);
    } finally {
      await client.endAsync(true);
    }
  });
});

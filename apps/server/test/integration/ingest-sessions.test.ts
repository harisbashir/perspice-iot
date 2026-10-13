import { sql } from 'drizzle-orm';
import mqtt from 'mqtt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmqxClient } from '../../src/emqx/emqx.client';
import { INGEST_SUBSCRIPTIONS, MqttIngestClient } from '../../src/ingest/mqtt-ingest.client';
import { TelemetryStore } from '../../src/ingest/telemetry-store';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp, INGEST_PASSWORD } from '../harness';
import { connectDevice } from '../mqtt-helpers';

/**
 * Ingest shares its subscriptions with any other ingest session. A previous container's session
 * (persistent, disconnected) would get half of all messages queued to it and lost: found when an
 * update recreated the ingest container under a new client id.
 */
describe('stale ingest sessions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('are removed on start-up, so no message is routed to a dead session', async () => {
    // What a previous ingest container leaves behind: a persistent session in the share group.
    const stale = await mqtt.connectAsync(t.mqttUrl!, {
      clientId: 'perspice-ingest-old-container-7',
      username: 'perspice-ingest',
      password: INGEST_PASSWORD,
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 3600 },
      reconnectPeriod: 0,
    });
    await stale.subscribeAsync(INGEST_SUBSCRIPTIONS, { qos: 1 });
    await stale.endAsync();
    const emqx = t.app.get(EmqxClient);
    const sessions = async () => (await emqx.listClients()).data.map((c) => c.clientid).filter((id) => id.startsWith('perspice-ingest-'));
    expect(await sessions()).toContain('perspice-ingest-old-container-7');

    await t.app.get(MqttIngestClient).removeStaleSessions();
    expect(await sessions()).not.toContain('perspice-ingest-old-container-7');

    // Every message now reaches ingest.
    const profile = await createProfile(t.db);
    const { device, token } = await createDevice(t.db, { profileId: profile.id });
    const client = await connectDevice(t, device.id, token);
    for (let i = 1; i <= 10; i++) await client.publishAsync(`perspice/v1/${device.id}/telemetry`, JSON.stringify({ values: { n: i } }), { qos: 1 });
    await client.endAsync();
    // All ten stored (with a dead member in the group, about half would be queued to it).
    const count = async () => {
      await t.app.get(TelemetryStore).writer.flush();
      const res = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM telemetry WHERE device_id = ${device.id} AND key = 'n'`);
      return res.rows[0]!.n;
    };
    const deadline = Date.now() + 10_000;
    let n = 0;
    while (Date.now() < deadline && (n = await count()) < 10) await new Promise((r) => setTimeout(r, 200));
    expect(n).toBe(10);
  });
});

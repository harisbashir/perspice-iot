import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { mockClient } from 'aws-sdk-client-mock';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { device } from '../../src/db/schema';
import { EmqxKickListener } from '../../src/emqx/emqx-kick.listener';
import { MessageRouter } from '../../src/ingest/message-router';
import { tokenFor } from '../auth-helpers';
import { createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

const dataPlane = mockClient(IoTDataPlaneClient);

describe('AWS IoT Core transport', () => {
  let t: TestApp;
  let auth: string;
  const clients: { endAsync: (force?: boolean) => Promise<void> }[] = [];

  beforeAll(async () => {
    // EMQX plays the IoT Core endpoint (the harness points AWS_IOT_MQTT_URL at it).
    t = await createTestApp({
      emqx: true,
      overrides: { MQTT_TRANSPORT: 'aws-iot', AWS_REGION: 'eu-west-1', AWS_IOT_ENDPOINT: 'abc-ats.iot.eu-west-1.amazonaws.com', AWS_IOT_CERT_PATH: '/x', AWS_IOT_KEY_PATH: '/x', AWS_IOT_CA_PATH: '/x' },
    });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  }, 180_000);

  afterEach(async () => {
    dataPlane.reset();
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    dataPlane.restore();
    await t?.close();
  });

  async function setup() {
    const profile = await createProfile(t.db, { commands: [{ name: 'reboot', label: 'Reboot', confirm: false }] });
    return createDevice(t.db, { profileId: profile.id, name: 'Remote' });
  }

  async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it('ingests device telemetry from the IoT endpoint', async () => {
    const { device: d, token } = await setup();
    const c = await connectDevice(t, d.id, token);
    clients.push(c);
    await c.publishAsync(`perspice/v1/${d.id}/telemetry`, JSON.stringify({ values: { fuel: 61 } }), { qos: 1 });
    const res = await eventually(() => t.http.get(`/api/devices/${d.id}/telemetry/latest`).set('Authorization', auth), (r) => !!r.body.fuel);
    expect(res.body.fuel.v).toBe(61);
  });

  it('follows AWS lifecycle events for presence', async () => {
    const { device: d } = await setup();
    const router = t.app.get(MessageRouter);
    const event = (kind: string, ts: number) => router.handle(`$aws/events/presence/${kind}/${d.id}`, Buffer.from(JSON.stringify({ clientId: d.id, timestamp: ts, eventType: kind, ipAddress: '203.0.113.9', disconnectReason: 'CLIENT_INITIATED_DISCONNECT' })));
    const status = () => t.db.query.device.findFirst({ where: eq(device.id, d.id) }).then((r) => r!.status);
    await event('connected', Date.now());
    expect(await eventually(status, (s) => s === 'online')).toBe('online');
    await event('disconnected', Date.now() + 1000);
    expect(await eventually(status, (s) => s === 'offline')).toBe('offline');
    // Lifecycle events of other clients (e.g. the ingest connection itself) are ignored.
    await router.handle('$aws/events/presence/connected/perspice-ingest-x', Buffer.from('{}'));
  });

  it('sends commands through the IoT data plane', async () => {
    dataPlane.on(PublishCommand).resolves({});
    const { device: d } = await setup();
    const res = await t.http.post(`/api/devices/${d.id}/commands`).set('Authorization', auth).send({ name: 'reboot' });
    expect(res.status).toBeLessThan(300);
    const call = await eventually(async () => dataPlane.commandCalls(PublishCommand)[0], (c) => !!c);
    const input = call!.args[0].input;
    expect(input).toMatchObject({ topic: `perspice/v1/${d.id}/cmd`, qos: 1, retain: false });
    expect(JSON.parse(Buffer.from(input.payload as Uint8Array).toString())).toMatchObject({ name: 'reboot', cid: res.body.id });
  });

  it('does not use EMQX session kicks', () => {
    expect(() => t.app.get(EmqxKickListener, { strict: false })).toThrow();
  });
});

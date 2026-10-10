import type { MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connect, connectDevice, connectIngest, listen, waitForClose } from '../mqtt-helpers';

describe('EMQX auth and ACL', () => {
  let t: TestApp;
  let auth: string;
  let profileId: string;
  const clients: MqttClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db)).id;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    await t?.close();
  });

  async function newDevice() {
    const res = await t.http.post('/api/devices').set('Authorization', auth).send({ name: 'mqtt-dev', profileId });
    return { id: res.body.device.id as string, token: res.body.token as string };
  }

  const track = (c: MqttClient) => (clients.push(c), c);

  it('hook endpoints require the internal secret', async () => {
    const res = await t.http.post('/internal/emqx/auth').send({ clientid: 'x', username: 'x', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('valid device connects', async () => {
    const d = await newDevice();
    const c = track(await connectDevice(t, d.id, d.token));
    expect(c.connected).toBe(true);
  });

  it('wrong token → connection refused', async () => {
    const d = await newDevice();
    await expect(connectDevice(t, d.id, 'pdt_wrong')).rejects.toMatchObject({ code: expect.any(Number) });
  });

  it('username must equal client id', async () => {
    const d = await newDevice();
    const other = await newDevice();
    await expect(connect(t, { clientId: other.id, username: d.id, password: d.token })).rejects.toBeTruthy();
  });

  it("device publishing to another device's telemetry topic is dropped", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const ingest = track(await connectIngest(t));
    const devA = track(await connectDevice(t, a.id, a.token));
    const foreign = await listen(ingest, 'perspice/v1/#', `perspice/v1/${b.id}/telemetry`);
    // MQTT 5 reports the denial in the PUBACK (0x87 Not authorized); the message is dropped.
    await expect(
      devA.publishAsync(`perspice/v1/${b.id}/telemetry`, JSON.stringify({ values: { t: 1 } }), { qos: 1 }),
    ).rejects.toThrow(/Not authorized/);
    expect(await foreign(1000)).toHaveLength(0);

    // ...while its own topic is delivered.
    const own = await listen(ingest, 'perspice/v1/#', `perspice/v1/${a.id}/telemetry`);
    await devA.publishAsync(`perspice/v1/${a.id}/telemetry`, JSON.stringify({ values: { t: 1 } }), { qos: 1 });
    expect(await own(1000)).toHaveLength(1);
  });

  it("decides a device's topics from the rules returned at authentication, without the ACL hook", async () => {
    const httpChecks = async () => {
      const res = await fetch(`${t.config.EMQX_API_URL}/api/v5/authorization/sources/http/status`, {
        headers: { authorization: `Basic ${Buffer.from(`${t.config.EMQX_API_KEY}:${t.config.EMQX_API_SECRET}`).toString('base64')}` },
      });
      return ((await res.json()) as { metrics: { total: number } }).metrics.total;
    };
    const a = await newDevice();
    const b = await newDevice();
    const devA = track(await connectDevice(t, a.id, a.token));
    const before = await httpChecks();
    await devA.subscribeAsync(`perspice/v1/${a.id}/cmd`, { qos: 1 });
    await devA.publishAsync(`perspice/v1/${a.id}/telemetry`, JSON.stringify({ values: { t: 1 } }), { qos: 1 });
    await devA.publishAsync(`perspice/v1/${a.id}/attributes`, JSON.stringify({ fw: '1.0' }), { qos: 1 });
    await expect(devA.publishAsync(`perspice/v1/${b.id}/telemetry`, '{}', { qos: 1 })).rejects.toThrow(/Not authorized/);
    expect(await httpChecks()).toBe(before);
  });

  it('device cannot subscribe to another device’s commands', async () => {
    const a = await newDevice();
    const b = await newDevice();
    const devA = track(await connectDevice(t, a.id, a.token));
    await expect(devA.subscribeAsync(`perspice/v1/${b.id}/cmd`, { qos: 1 })).rejects.toThrow(/Not authorized/);
    await expect(devA.subscribeAsync('perspice/v1/+/cmd', { qos: 1 })).rejects.toThrow(/Not authorized/);
    const ok = await devA.subscribeAsync(`perspice/v1/${a.id}/cmd`, { qos: 1 });
    expect(ok[0]?.qos).toBe(1);
  });

  describe('revocation (Review Focus 4)', () => {
    it('connected device is disconnected within 5 s after DELETE', async () => {
      const d = await newDevice();
      const c = track(await connectDevice(t, d.id, d.token));
      const closed = waitForClose(c, 5000);
      expect((await t.http.delete(`/api/devices/${d.id}`).set('Authorization', auth)).status).toBe(204);
      await closed;
      await expect(connectDevice(t, d.id, d.token)).rejects.toBeTruthy();
    });

    it('after token regenerate the session is kicked and the old token is rejected', async () => {
      const d = await newDevice();
      const c = track(await connectDevice(t, d.id, d.token));
      const closed = waitForClose(c, 5000);
      const regen = await t.http.post(`/api/devices/${d.id}/credentials/regenerate`).set('Authorization', auth);
      await closed;
      await expect(connectDevice(t, d.id, d.token)).rejects.toBeTruthy();
      track(await connectDevice(t, d.id, regen.body.token));
    });
  });
});

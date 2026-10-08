import { and, eq } from 'drizzle-orm';
import type { MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CommandTimeoutJob } from '../../src/commands/command-timeout.job';
import { auditLog } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < deadline);
  return last;
}

const COMMANDS = [
  { name: 'gen_start', label: 'Start generator', confirm: true },
  {
    name: 'set_interval',
    label: 'Set interval',
    confirm: false,
    paramsSchema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: 5 } },
      required: ['seconds'],
      additionalProperties: false,
    },
  },
];

describe('commands', () => {
  let t: TestApp;
  let auth: string;
  const clients: MqttClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    await t?.close();
  });

  async function newDevice(opts: { transport?: 'mqtt' | 'http'; customerId?: string } = {}) {
    const profile = await createProfile(t.db, { commands: COMMANDS, transport: opts.transport ?? 'mqtt' });
    const res = await t.http
      .post('/api/devices')
      .set('Authorization', auth)
      .send({ name: 'cmd-dev', profileId: profile.id, customerId: opts.customerId });
    return { id: res.body.device.id as string, token: res.body.token as string };
  }

  /** Connects a device that acks every command with `{ echo: params }`. */
  async function ackingDevice(d: { id: string; token: string }, status: 'success' | 'failed' = 'success') {
    const client = await connectDevice(t, d.id, d.token);
    clients.push(client);
    client.on('message', (topic, payload) => {
      if (!topic.endsWith('/cmd')) return;
      const cmd = JSON.parse(payload.toString()) as { cid: string; params: unknown };
      void client.publishAsync(
        `perspice/v1/${d.id}/cmd/ack`,
        JSON.stringify({ cid: cmd.cid, status, result: { echo: cmd.params } }),
        { qos: 1 },
      );
    });
    await client.subscribeAsync(`perspice/v1/${d.id}/cmd`, { qos: 1 });
    await eventually(() => t.http.get(`/api/devices/${d.id}`).set('Authorization', auth), (r) => r.body.status === 'online');
    return client;
  }

  const getCommand = (id: string) => t.http.get(`/api/commands/${id}`).set('Authorization', auth);

  it('delivers over MQTT and completes with the device result', async () => {
    const d = await newDevice();
    await ackingDevice(d);
    const res = await t.http
      .post(`/api/devices/${d.id}/commands`)
      .set('Authorization', auth)
      .send({ name: 'set_interval', params: { seconds: 30 } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'set_interval', params: { seconds: 30 }, status: 'sent' });
    const done = await eventually(() => getCommand(res.body.id), (r) => r.body.status === 'success');
    expect(done.body).toMatchObject({ status: 'success', result: { echo: { seconds: 30 } } });
    expect(done.body.completedAt).toEqual(expect.any(Number));

    const history = await t.http.get(`/api/devices/${d.id}/commands`).set('Authorization', auth);
    expect(history.body.map((c: { id: string }) => c.id)).toContain(res.body.id);
  });

  it('records the command and its params in the audit log', async () => {
    const d = await newDevice();
    const res = await t.http
      .post(`/api/devices/${d.id}/commands`)
      .set('Authorization', auth)
      .send({ name: 'set_interval', params: { seconds: 10 } });
    const row = await t.db.query.auditLog.findFirst({
      where: and(eq(auditLog.action, 'device.command'), eq(auditLog.targetId, d.id)),
    });
    expect(row?.diff).toMatchObject({ name: 'set_interval', params: { seconds: 10 } });
    expect(res.status).toBe(201);
  });

  it('rejects undeclared commands and invalid params with 400', async () => {
    const d = await newDevice();
    const undeclared = await t.http.post(`/api/devices/${d.id}/commands`).set('Authorization', auth).send({ name: 'self_destruct' });
    expect(undeclared.status).toBe(400);
    const badParams = await t.http
      .post(`/api/devices/${d.id}/commands`)
      .set('Authorization', auth)
      .send({ name: 'set_interval', params: { seconds: 1 } });
    expect(badParams.status).toBe(400);
  });

  it('viewers cannot send commands', async () => {
    const c = await createCustomer(t.db);
    const d = await newDevice({ customerId: c.id });
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    const vAuth = `Bearer ${await tokenFor(t, viewer.email, viewer.password, `${c.slug}.localhost`)}`;
    expect((await t.http.post(`/api/devices/${d.id}/commands`).set('Authorization', vAuth).send({ name: 'gen_start' })).status).toBe(403);
  });

  it('times out when no ack arrives within ttl', async () => {
    const d = await newDevice();
    const res = await t.http.post(`/api/devices/${d.id}/commands`).set('Authorization', auth).send({ name: 'gen_start', ttlS: 5 });
    const job = t.app.get(CommandTimeoutJob);
    await job.run(new Date(Date.now() + 2_000));
    expect((await getCommand(res.body.id)).body.status).not.toBe('timeout');
    await job.run(new Date(Date.now() + 6_000));
    expect((await getCommand(res.body.id)).body.status).toBe('timeout');
  });

  it('holds a persistUntilOnline command for an offline device and sends it on reconnect', async () => {
    const d = await newDevice();
    const res = await t.http
      .post(`/api/devices/${d.id}/commands`)
      .set('Authorization', auth)
      .send({ name: 'gen_start', persistUntilOnline: true, ttlS: 600 });
    expect(res.body.status).toBe('queued');
    await ackingDevice(d);
    const done = await eventually(() => getCommand(res.body.id), (r) => r.body.status === 'success');
    expect(done.body.status).toBe('success');
  });

  it('ignores an ack for the same cid from another device', async () => {
    const target = await newDevice();
    const other = await newDevice();
    const res = await t.http.post(`/api/devices/${target.id}/commands`).set('Authorization', auth).send({ name: 'gen_start' });
    const intruder = await connectDevice(t, other.id, other.token);
    clients.push(intruder);
    await intruder.publishAsync(`perspice/v1/${other.id}/cmd/ack`, JSON.stringify({ cid: res.body.id, status: 'success' }), { qos: 1 });
    await new Promise((r) => setTimeout(r, 1000));
    expect((await getCommand(res.body.id)).body.status).toBe('sent');
  });

  it('delivers over HTTP long-poll and accepts the ack', async () => {
    const d = await newDevice({ transport: 'http' });
    const poll = t.http.get('/api/v1/device/commands?wait=5').set('X-Device-Token', d.token);
    await new Promise((r) => setTimeout(r, 300));
    const res = await t.http.post(`/api/devices/${d.id}/commands`).set('Authorization', auth).send({ name: 'gen_start' });
    expect(res.body.status).toBe('queued');
    const got = await poll;
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ cid: res.body.id, name: 'gen_start' });
    expect((await getCommand(res.body.id)).body.status).toBe('sent');

    const ack = await t.http
      .post(`/api/v1/device/commands/${res.body.id}/ack`)
      .set('X-Device-Token', d.token)
      .send({ status: 'failed', result: { error: 'fuel_empty' } });
    expect(ack.status).toBe(202);
    expect((await getCommand(res.body.id)).body).toMatchObject({ status: 'failed', result: { error: 'fuel_empty' } });

    const empty = await t.http.get('/api/v1/device/commands?wait=0').set('X-Device-Token', d.token);
    expect(empty.status).toBe(204);
  });

  it('publishes shared attributes retained on the config topic', async () => {
    const d = await newDevice();
    await t.http.put(`/api/devices/${d.id}/attributes/shared`).set('Authorization', auth).send({ interval: 42 });
    await new Promise((r) => setTimeout(r, 1000));
    const client = await connectDevice(t, d.id, d.token);
    clients.push(client);
    const got = new Promise<string>((resolve) => client.on('message', (_t, p) => resolve(p.toString())));
    await client.subscribeAsync(`perspice/v1/${d.id}/config`, { qos: 1 });
    expect(JSON.parse(await got)).toEqual({ interval: 42 });
  });
});

import type { OtaMessage } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import type { MqttClient } from 'mqtt';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { device } from '../../src/db/schema';
import { OtaService } from '../../src/firmware/ota.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('OTA updates', () => {
  let t: TestApp;
  let platform: string;
  let customer: { id: string; auth: string };
  const clients: MqttClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    customer = { id: c.id, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }, 180_000);

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    await t?.close();
  });

  const ota = () => t.app.get(OtaService);
  const image = randomBytes(20_000);

  /** A profile with firmware 2.0.0 and `n` devices on 1.0.0 (online unless said otherwise). */
  async function fleet(n: number, opts: { offline?: number[]; transport?: 'mqtt' | 'http' } = {}) {
    const profile = await createProfile(t.db, { transport: opts.transport ?? 'mqtt' });
    const fw = (
      await t.http
        .post(`/api/firmware?profileId=${profile.id}&version=2.0.0`)
        .set('Authorization', platform)
        .set('content-type', 'application/octet-stream')
        .send(image)
    ).body as { id: string };
    const devices: { id: string; token: string; inbox: OtaMessage[]; client?: MqttClient }[] = [];
    for (let i = 0; i < n; i++) {
      const offline = opts.offline?.includes(i);
      const { device: d, token } = await createDevice(t.db, { profileId: profile.id, customerId: customer.id, name: `Unit ${i}`, firmwareVersion: '1.0.0', status: offline ? 'offline' : 'online' });
      const entry: (typeof devices)[number] = { id: d.id, token, inbox: [] };
      // An offline device isn't connected (connecting would bring it online).
      if (opts.transport !== 'http' && !offline) await connect(entry);
      devices.push(entry);
    }
    return { profile, fw, devices };
  }

  async function connect(entry: { id: string; token: string; inbox: OtaMessage[]; client?: MqttClient }) {
    const c = await connectDevice(t, entry.id, entry.token);
    clients.push(c);
    await c.subscribeAsync(`perspice/v1/${entry.id}/ota`, { qos: 1 });
    c.on('message', (topic, payload) => {
      if (topic.endsWith('/ota')) entry.inbox.push(JSON.parse(payload.toString()) as OtaMessage);
    });
    entry.client = c;
  }

  const createJob = (body: object, auth = platform) => t.http.post('/api/ota-jobs').set('Authorization', auth).send(body);
  const job = (id: string) => t.http.get(`/api/ota-jobs/${id}`).set('Authorization', platform).then((r) => r.body);
  const progress = (d: { id: string; client?: MqttClient }, body: object) =>
    d.client!.publishAsync(`perspice/v1/${d.id}/ota/progress`, JSON.stringify(body), { qos: 1 });
  const reportFw = (d: { id: string; client?: MqttClient }, fw: string) => d.client!.publishAsync(`perspice/v1/${d.id}/attributes`, JSON.stringify({ fw }), { qos: 1 });

  it('rolls out in batches: download link and checksum, progress, applied once the device reports the version', async () => {
    const { profile, fw, devices } = await fleet(3);
    const created = await createJob({ firmwareId: fw.id, target: { kind: 'profile' }, batchSize: 2 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'running', counts: { pending: 3 } });
    // The scheduler ticks every 15 s; here, until the publisher has connected and sent.
    const first = await eventually(
      async () => {
        await ota().tick();
        return devices.filter((d) => d.inbox.length);
      },
      (s) => s.length === 2,
    );
    expect(first).toHaveLength(2);
    const msg = first[0]!.inbox[0]!;
    expect(msg).toMatchObject({ jobId: created.body.id, version: '2.0.0', size: 20_000, sha256: createHash('sha256').update(image).digest('hex') });
    // The link downloads the image.
    const url = new URL(msg.url);
    const dl = await t.http.get(url.pathname + url.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(Buffer.compare(dl.body as Buffer, image)).toBe(0);

    for (const d of first) {
      await progress(d, { version: '2.0.0', state: 'downloading', pct: 50 });
      await progress(d, { version: '2.0.0', state: 'applied' });
    }
    // "applied" from the device alone isn't enough: it must come back reporting the version.
    const waiting = await eventually(() => job(created.body.id), (j) => j.counts.verifying === 2);
    expect(waiting.counts).toMatchObject({ verifying: 2, applied: 0 });
    for (const d of first) await reportFw(d, '2.0.0');
    await eventually(() => job(created.body.id), (j) => j.counts.applied === 2);

    const third = devices.find((d) => !d.inbox.length)!;
    await ota().tick();
    await eventually(async () => third.inbox.length, (n) => n === 1);
    await reportFw(third, '2.0.0');
    await eventually(() => job(created.body.id), (j) => j.counts.applied === 3);
    await ota().tick();
    expect(await job(created.body.id)).toMatchObject({ status: 'completed', finishedAt: expect.any(Number) });
    const perDevice = await t.http.get(`/api/ota-jobs/${created.body.id}/devices`).set('Authorization', platform);
    expect(perDevice.body.map((d: { state: string }) => d.state)).toEqual(['applied', 'applied', 'applied']);
    expect((await t.db.query.device.findFirst({ where: eq(device.profileId, profile.id) }))!.firmwareVersion).toBe('2.0.0');
  });

  it('halts when too many devices fail, leaving the rest untouched', async () => {
    const { fw, devices } = await fleet(4);
    const created = (await createJob({ firmwareId: fw.id, target: { kind: 'profile' }, batchSize: 2, maxFailurePct: 20 })).body;
    await ota().tick();
    const sent = await eventually(async () => devices.filter((d) => d.inbox.length), (s) => s.length === 2);
    for (const d of sent) await progress(d, { version: '2.0.0', state: 'failed', error: 'checksum mismatch' });
    await eventually(() => job(created.id), (j) => j.counts.failed === 2);
    await ota().tick();
    const halted = await job(created.id);
    expect(halted).toMatchObject({ status: 'halted', haltReason: '2 of 2 devices failed (more than 20%)', counts: { pending: 2, failed: 2 } });
    const rows = (await t.http.get(`/api/ota-jobs/${created.id}/devices`).set('Authorization', platform)).body as { state: string; error: string | null }[];
    expect(rows.filter((r) => r.state === 'failed').map((r) => r.error)).toEqual(['checksum mismatch', 'checksum mismatch']);
  });

  it('fails devices that never finish', async () => {
    const { fw, devices } = await fleet(1);
    const created = (await createJob({ firmwareId: fw.id, target: { kind: 'profile' }, timeoutMin: 5 })).body;
    await ota().tick();
    await eventually(async () => devices[0]!.inbox.length, (n) => n === 1);
    await ota().tick(Date.now() + 6 * 60_000);
    expect((await job(created.id)).status).toBe('completed');
    const [row] = (await t.http.get(`/api/ota-jobs/${created.id}/devices`).set('Authorization', platform)).body;
    expect(row).toMatchObject({ state: 'failed', error: 'Timed out' });
  });

  it('waits for offline devices, and skips those already on the version', async () => {
    const { fw, devices } = await fleet(3, { offline: [0] });
    await t.db.update(device).set({ firmwareVersion: '2.0.0' }).where(eq(device.id, devices[2]!.id));
    const created = (await createJob({ firmwareId: fw.id, target: { kind: 'profile' } })).body;
    expect(created.counts).toMatchObject({ pending: 2, skipped: 1 });
    await ota().tick();
    await eventually(async () => devices[1]!.inbox.length, (n) => n === 1);
    expect(devices[0]!.inbox).toHaveLength(0);
    await connect(devices[0]!);
    await eventually(() => t.db.query.device.findFirst({ where: eq(device.id, devices[0]!.id) }).then((d) => d!.status), (s) => s === 'online');
    await ota().tick();
    await eventually(async () => devices[0]!.inbox.length, (n) => n === 1);
    expect(devices[2]!.inbox).toHaveLength(0);
  });

  it('cancels: nothing more is sent', async () => {
    const { fw, devices } = await fleet(3);
    const created = (await createJob({ firmwareId: fw.id, target: { kind: 'profile' }, batchSize: 1 })).body;
    await ota().tick();
    await eventually(async () => devices.filter((d) => d.inbox.length).length, (n) => n === 1);
    expect((await t.http.post(`/api/ota-jobs/${created.id}/cancel`).set('Authorization', platform)).status).toBe(200);
    await ota().tick(Date.now() + 60 * 60_000);
    expect(devices.filter((d) => d.inbox.length)).toHaveLength(1);
    expect(await job(created.id)).toMatchObject({ status: 'cancelled', counts: { skipped: 2 } });
  });

  it('serves HTTP devices through the device API', async () => {
    const { fw, devices } = await fleet(1, { transport: 'http' });
    const d = devices[0]!;
    const before = await t.http.get('/api/v1/device/ota').set('x-device-token', d.token);
    expect(before.status).toBe(204);
    await createJob({ firmwareId: fw.id, target: { kind: 'devices', deviceIds: [d.id] } });
    await ota().tick();
    const res = await t.http.get('/api/v1/device/ota').set('x-device-token', d.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: '2.0.0', size: 20_000 });
    expect((await t.http.post('/api/v1/device/ota/progress').set('x-device-token', d.token).send({ version: '2.0.0', state: 'downloading', pct: 10 })).status).toBe(202);
  });

  it("only targets the firmware's own profile", async () => {
    const { fw } = await fleet(1);
    const other = await createProfile(t.db);
    const { device: stranger } = await createDevice(t.db, { profileId: other.id });
    expect((await createJob({ firmwareId: fw.id, target: { kind: 'devices', deviceIds: [stranger.id] } })).status).toBe(400);
  });

  it('customers see their devices’ update status but not the jobs', async () => {
    const { fw, devices } = await fleet(1);
    const created = (await createJob({ firmwareId: fw.id, target: { kind: 'profile' } })).body;
    expect((await createJob({ firmwareId: fw.id, target: { kind: 'profile' } }, customer.auth)).status).toBe(403);
    expect((await t.http.get(`/api/ota-jobs/${created.id}`).set('Authorization', customer.auth)).status).toBe(403);
    const mine = await t.http.get(`/api/devices/${devices[0]!.id}/ota`).set('Authorization', customer.auth);
    expect(mine.status).toBe(200);
    expect(mine.body[0]).toMatchObject({ jobId: created.id, version: '2.0.0', state: 'pending' });
  });

  it('firmware used by a job can not be deleted', async () => {
    const { fw } = await fleet(1);
    await createJob({ firmwareId: fw.id, target: { kind: 'profile' } });
    expect((await t.http.delete(`/api/firmware/${fw.id}`).set('Authorization', platform)).status).toBe(409);
  });
});

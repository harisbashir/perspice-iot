import { and, eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliveryLog, webhook } from '../../src/db/schema';
import { Dispatcher } from '../../src/delivery/dispatcher';
import { EventBus } from '../../src/events/event-bus';
import { SettingsService } from '../../src/settings/settings.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const verify = (secret: string, r: Received) =>
  `sha256=${createHmac('sha256', secret).update(`${r.headers['x-perspice-timestamp']}.${r.body}`).digest('hex')}` === r.headers['x-perspice-signature'];

describe('webhooks', () => {
  let t: TestApp;
  let platform: string;
  let receiver: Server;
  let base: string;
  const received: Received[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push({ path: req.url!, headers: req.headers, body });
        if (req.url!.startsWith('/redirect')) res.writeHead(302, { location: '/ok' }).end();
        else res.writeHead(req.url!.startsWith('/fail') ? 500 : 200).end('ok');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    received.length = 0;
    // The receiver is a local HTTP server, so tests allow it unless they check the default policy.
    await t.app.get(SettingsService).set('webhooks.policy', { allowHttp: true, allowPrivate: true });
  });

  afterAll(async () => {
    receiver?.close();
    await t?.close();
  });

  async function tenant() {
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const profile = await createProfile(t.db);
    const { device, token } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Site 4' });
    return { c, profile, device, token, auth: `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}` };
  }

  const create = (auth: string, body: Record<string, unknown>) =>
    t.http.post('/api/webhooks').set('Authorization', auth).send({ name: 'Ops', events: ['alarm.raised', 'alarm.cleared'], ...body });

  async function waitFor(pred: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  }

  it('refuses private, loopback, metadata and plain-HTTP destinations by default (Review Focus 3)', async () => {
    await t.app.get(SettingsService).set('webhooks.policy', { allowHttp: false, allowPrivate: false });
    const a = await tenant();
    for (const url of [`${base}/ok`, 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://10.0.0.5/x']) {
      const res = await create(a.auth, { url });
      expect(res.status, url).toBe(400);
    }
    expect((await t.http.put('/api/settings/webhooks').set('Authorization', platform).send({ allowHttp: true, allowPrivate: true })).status).toBe(403);
  });

  it('shows the secret once and signs every call with it', async () => {
    const a = await tenant();
    const res = await create(a.auth, { url: `${base}/ok` });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.customerId).toBe(a.c.id);
    const list = await t.http.get('/api/webhooks').set('Authorization', a.auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].secret).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(res.body.secret);
    const stored = await t.db.query.webhook.findFirst({ where: eq(webhook.id, res.body.id) });
    expect(stored!.secretEnc).not.toContain(res.body.secret);

    const ping = await t.http.post(`/api/webhooks/${res.body.id}/test`).set('Authorization', a.auth);
    expect(ping.body).toEqual({ ok: true, status: 200, error: null });
    expect(received).toHaveLength(1);
    expect(received[0]!.headers['x-perspice-event']).toBe('ping');
    expect(verify(res.body.secret, received[0]!)).toBe(true);

    const rotated = await t.http.post(`/api/webhooks/${res.body.id}/rotate-secret`).set('Authorization', a.auth);
    expect(rotated.body.secret).not.toBe(res.body.secret);
    await t.http.post(`/api/webhooks/${res.body.id}/test`).set('Authorization', a.auth);
    expect(verify(rotated.body.secret, received[1]!)).toBe(true);
    expect(verify(res.body.secret, received[1]!)).toBe(false);
  });

  it('delivers alarm events to the device customer’s and platform webhooks only', async () => {
    const a = await tenant();
    const b = await tenant();
    const ha = (await create(a.auth, { url: `${base}/a` })).body;
    await create(b.auth, { url: `${base}/b` });
    const hp = (await create(platform, { url: `${base}/platform` })).body;
    await t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Low fuel', severity: 'major', scope: { kind: 'profile', profileId: a.profile.id }, type: 'threshold', condition: { key: 'fuel_level', op: '<', value: 20 }, channels: [] })
      .expect(201);
    await t.http.post('/api/v1/device/telemetry').set('x-device-token', a.token).send({ values: { fuel_level: 3 } }).expect(202);
    await waitFor(() => received.length >= 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(received.map((r) => r.path).sort()).toEqual(['/a', '/platform']);
    const toA = received.find((r) => r.path === '/a')!;
    expect(verify(ha.secret, toA)).toBe(true);
    expect(verify(hp.secret, received.find((r) => r.path === '/platform')!)).toBe(true);
    const body = JSON.parse(toA.body);
    expect(body).toMatchObject({ event: 'alarm.raised', data: { alarm: { rule: 'Low fuel', severity: 'major', status: 'active' }, device: { id: a.device.id, name: 'Site 4' }, customerId: a.c.id } });
    expect(toA.headers['x-perspice-delivery']).toBe(body.id);
  });

  it('delivers device status changes to subscribed webhooks', async () => {
    const a = await tenant();
    await create(a.auth, { url: `${base}/status`, events: ['device.status_changed'] });
    await t.app.get(EventBus).publish({ type: 'device.status_changed', deviceId: a.device.id, customerId: a.c.id, from: 'online', to: 'offline', reason: 'test', ts: Date.now() });
    await waitFor(() => received.length === 1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({ event: 'device.status_changed', data: { device: { name: 'Site 4' }, from: 'online', to: 'offline' } });
  });

  it('does not follow redirects and re-checks the destination when sending (Review Focus 3)', async () => {
    const a = await tenant();
    const redirect = (await create(a.auth, { url: `${base}/redirect` })).body;
    const id = await t.app.get(Dispatcher).enqueueWebhook(redirect.id, a.c.id, 'x', 'alarm.raised', {});
    await waitFor(() => received.length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(received.map((r) => r.path)).toEqual(['/redirect']);
    const row = await t.db.query.deliveryLog.findFirst({ where: eq(deliveryLog.id, id) });
    expect(row!.error).toMatch(/redirects are not followed/);

    // Saved while private destinations were allowed, refused once the policy is tightened.
    const ok = (await create(a.auth, { url: `${base}/ok` })).body;
    await t.app.get(SettingsService).set('webhooks.policy', { allowHttp: true, allowPrivate: false });
    const test = await t.http.post(`/api/webhooks/${ok.id}/test`).set('Authorization', a.auth);
    expect(test.body).toMatchObject({ ok: false, error: expect.stringMatching(/private/) });
    expect(received).toHaveLength(1);
    expect(await t.db.select().from(deliveryLog).where(and(eq(deliveryLog.webhookId, ok.id)))).toHaveLength(0);
  });
});

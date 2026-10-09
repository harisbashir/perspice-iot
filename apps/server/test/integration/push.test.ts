import { eq } from 'drizzle-orm';
import { createECDH, generateKeyPairSync, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deliveryLog, pushSubscription } from '../../src/db/schema';
import { PushService } from '../../src/delivery/push.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

function vapid() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]);
  return { VAPID_PUBLIC_KEY: raw.toString('base64url'), VAPID_PRIVATE_KEY: privateKey.export({ format: 'jwk' }).d!, VAPID_SUBJECT: 'mailto:ops@perspice.test' };
}

/** What a browser hands to the server after `pushManager.subscribe`. */
function browserSubscription(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

describe('web push', () => {
  let t: TestApp;
  let keys: ReturnType<typeof vapid>;
  const sent: { endpoint: string; headers: Record<string, string>; body: Buffer }[] = [];

  beforeAll(async () => {
    keys = vapid();
    t = await createTestApp({ overrides: keys });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sent.length = 0;
  });

  afterAll(async () => {
    await t?.close();
  });

  /** Stubs only the HTTPS call; the request (VAPID JWT, encryption) is built by web-push itself. */
  function fakePushService() {
    vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, payload, opts) => {
      const d = webpush.generateRequestDetails(sub, payload as string, opts);
      sent.push({ endpoint: d.endpoint, headers: d.headers as Record<string, string>, body: d.body as Buffer });
      if (d.endpoint.includes('/gone/')) throw new webpush.WebPushError('Gone', 410, {}, 'Gone', d.endpoint);
      if (d.endpoint.includes('/down/')) throw new webpush.WebPushError('Down', 503, {}, 'Down', d.endpoint);
      return { statusCode: 201, body: '', headers: {} };
    });
  }

  async function user() {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    return { c, u, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  it('publishes the VAPID key and manages a user’s subscriptions', async () => {
    const a = await user();
    const b = await user();
    const key = await t.http.get('/api/push/public-key').set('Authorization', a.auth);
    expect(key.body).toEqual({ publicKey: keys.VAPID_PUBLIC_KEY, subscriptions: 0 });

    const sub = browserSubscription('https://push.example.com/send/abc');
    await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send(sub).expect(204);
    await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send(sub).expect(204); // idempotent
    expect((await t.http.get('/api/push/public-key').set('Authorization', a.auth)).body.subscriptions).toBe(1);

    // Someone else can't remove it.
    await t.http.delete('/api/push/subscriptions').set('Authorization', b.auth).send({ endpoint: sub.endpoint }).expect(204);
    expect(await t.db.select().from(pushSubscription).where(eq(pushSubscription.userId, a.u.id))).toHaveLength(1);
    await t.http.delete('/api/push/subscriptions').set('Authorization', a.auth).send({ endpoint: sub.endpoint }).expect(204);
    expect(await t.db.select().from(pushSubscription).where(eq(pushSubscription.userId, a.u.id))).toHaveLength(0);
    expect((await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send({ endpoint: 'nope' })).status).toBe(400);
  });

  it('sends VAPID-signed, encrypted pushes and removes subscriptions the push service has dropped', async () => {
    fakePushService();
    const a = await user();
    await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send(browserSubscription('https://push.example.com/send/live')).expect(204);
    await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send(browserSubscription('https://push.example.com/gone/old')).expect(204);

    const ok = await t.app.get(PushService).send(a.u.id, { title: 'Hi', body: 'There', url: null, severity: 'major' });
    expect(ok).toBe(1);
    expect(sent).toHaveLength(2);
    const live = sent.find((s) => s.endpoint.endsWith('/live'))!;
    expect(live.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.VAPID_PUBLIC_KEY}$`));
    expect(live.headers['Content-Encoding']).toBe('aes128gcm');
    expect(live.body.includes(Buffer.from('There'))).toBe(false); // encrypted
    expect((await t.db.select().from(pushSubscription).where(eq(pushSubscription.userId, a.u.id))).map((s) => s.endpoint)).toEqual(['https://push.example.com/send/live']);
  });

  it('delivers alarm notifications by push and retries when the push service is down', async () => {
    fakePushService();
    const a = await user();
    const platformUser = await createUser(t.db, { roleKey: 'platform_admin' });
    const platform = `Bearer ${await tokenFor(t, platformUser.email, platformUser.password)}`;
    await t.http.post('/api/push/subscriptions').set('Authorization', a.auth).send(browserSubscription('https://push.example.com/send/x')).expect(204);
    const profile = await createProfile(t.db);
    const { token } = await createDevice(t.db, { profileId: profile.id, customerId: a.c.id });
    await t.http
      .post('/api/alarm-rules')
      .set('Authorization', platform)
      .send({ name: 'Door', severity: 'minor', scope: { kind: 'profile', profileId: profile.id }, type: 'state_match', condition: { key: 'door', values: [true] }, recipients: { roles: ['customer_admin'] }, channels: ['push'] })
      .expect(201);
    await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: { door: true } }).expect(202);
    for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    const [log] = await t.db.select().from(deliveryLog).where(eq(deliveryLog.userId, a.u.id));
    expect(log).toMatchObject({ channel: 'push', status: 'sent' });

    await t.db.update(pushSubscription).set({ endpoint: 'https://push.example.com/down/x' }).where(eq(pushSubscription.userId, a.u.id));
    await expect(t.app.get(PushService).send(a.u.id, { title: 'x', body: 'y', url: null, severity: 'info' })).rejects.toThrow(/Push failed: 503/);
  });

  it('is unavailable without VAPID keys', async () => {
    const plain = await createTestApp();
    try {
      const c = await createCustomer(plain.db);
      const u = await createUser(plain.db, { roleKey: 'customer_admin', customerId: c.id });
      const auth = `Bearer ${await tokenFor(plain, u.email, u.password, `${c.slug}.localhost`)}`;
      expect((await plain.http.get('/api/push/public-key').set('Authorization', auth)).body.publicKey).toBeNull();
      expect((await plain.http.post('/api/push/subscriptions').set('Authorization', auth).send(browserSubscription('https://p.example/x'))).status).toBe(400);
    } finally {
      await plain.close();
    }
  });
});

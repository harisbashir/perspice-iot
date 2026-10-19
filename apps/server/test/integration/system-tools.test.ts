import webpush from 'web-push';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appVersion } from '../../src/common/version';
import { PushService } from '../../src/delivery/push.service';
import { SettingsService } from '../../src/settings/settings.service';
import { tokenFor } from '../auth-helpers';
import { createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('system tools in the app', () => {
  let t: TestApp;
  let superAdmin: string;
  let platformAdmin: string;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
    const s = await createUser(t.db, { roleKey: 'super_admin' });
    superAdmin = `Bearer ${await tokenFor(t, s.email, s.password)}`;
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformAdmin = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('sets up push notifications without editing the server configuration, once', async () => {
    expect((await t.http.get('/api/push/public-key').set('Authorization', superAdmin)).body.publicKey).toBeNull();
    expect((await t.http.post('/api/system/push').set('Authorization', platformAdmin)).status).toBe(403);
    const res = await t.http.post('/api/system/push').set('Authorization', superAdmin);
    expect(res.status).toBe(201);
    expect(res.body.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect((await t.http.get('/api/push/public-key').set('Authorization', superAdmin)).body.publicKey).toBe(res.body.publicKey);
    // New keys would cut off every browser already subscribed.
    expect((await t.http.post('/api/system/push').set('Authorization', superAdmin)).status).toBe(409);

    const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    expect((await t.http.post('/api/push/subscriptions').set('Authorization', superAdmin).send(sub)).status).toBe(204);
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const me = (await t.http.get('/api/auth/me').set('Authorization', superAdmin)).body as { id: string };
    expect(await t.app.get(PushService).send(me.id, { title: 'x', body: 'y', url: null, severity: 'major' })).toBe(1);
    expect(send.mock.calls[0]![2]).toMatchObject({ vapidDetails: { publicKey: res.body.publicKey } });
  });

  it('runs the end-to-end check: a value published over MQTT is stored', async () => {
    expect((await t.http.post('/api/system/roundtrip').set('Authorization', platformAdmin)).status).toBe(403);
    const res = await t.http.post('/api/system/roundtrip').set('Authorization', superAdmin);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, ms: expect.any(Number) });
  });

  it('says when a newer release is published, and stays quiet when it can’t tell', async () => {
    await t.redis.del('system:latest-release');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com/x/y/releases/tag/v99.0.0' }), { status: 200 }),
    );
    const res = await t.http.get('/api/system/update').set('Authorization', superAdmin);
    expect(res.body).toEqual({ current: appVersion(), latest: '99.0.0', updateAvailable: true, url: 'https://github.com/x/y/releases/tag/v99.0.0' });
    // Cached: GitHub is asked at most every few hours.
    await t.http.get('/api/system/update').set('Authorization', superAdmin);
    expect(fetch).toHaveBeenCalledTimes(1);

    await t.redis.del('system:latest-release');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const offline = await t.http.get('/api/system/update').set('Authorization', superAdmin);
    expect(offline.body).toMatchObject({ current: appVersion(), latest: null, updateAvailable: false });
  });
});

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsService } from '../../src/settings/settings.service';
import { login, refreshCookie, tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('account and security settings', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('changes the password with the current one and signs out other sessions', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const other = refreshCookie(await login(t, u.email, u.password))!;
    const res = await login(t, u.email, u.password);
    const auth = `Bearer ${res.body.accessToken}`;
    const current = refreshCookie(res)!;

    const wrong = await t.http.post('/api/auth/password').set('Authorization', auth).send({ currentPassword: 'nope-nope-nope', newPassword: 'brand-new-password' });
    expect(wrong.status).toBe(400);
    const short = await t.http.post('/api/auth/password').set('Authorization', auth).send({ currentPassword: u.password, newPassword: 'short' });
    expect(short.status).toBe(400);

    const ok = await t.http.post('/api/auth/password').set('Authorization', auth).send({ currentPassword: u.password, newPassword: 'brand-new-password' });
    expect(ok.status).toBe(204);
    expect((await login(t, u.email, 'brand-new-password')).status).toBe(200);
    expect((await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', other)).status).toBe(401);
    expect((await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', current)).status).toBe(200);
  });

  it('reads and updates security settings (system.settings only)', async () => {
    const admin = await createUser(t.db, { roleKey: 'super_admin' });
    // Super admins must enrol TOTP before reaching settings; switch enforcement off for this test.
    await t.app.get(SettingsService).set('auth.enforceTotpForSuperAdmin', false);
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password)}`;
    const get = await t.http.get('/api/settings/security').set('Authorization', auth);
    expect(get.body).toEqual({ enforceTotpForSuperAdmin: false, docsPublic: false });
    const put = await t.http.put('/api/settings/security').set('Authorization', auth).send({ docsPublic: true });
    expect(put.body).toEqual({ enforceTotpForSuperAdmin: false, docsPublic: true });

    const c = await createCustomer(t.db);
    const ca = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const cAuth = `Bearer ${await tokenFor(t, ca.email, ca.password, `${c.slug}.localhost`)}`;
    expect((await t.http.get('/api/settings/security').set('Authorization', cAuth)).status).toBe(403);
  });
});

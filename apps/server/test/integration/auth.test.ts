import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenService } from '../../src/auth/token.service';
import { session, user } from '../../src/db/schema';
import { REFRESH_COOKIE, login, refreshCookie, tokenFor, totpCode } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, listMail, mailText, waitForMail } from '../mailpit';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('login succeeds and returns access token + refresh cookie', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const res = await login(t, u.email, u.password);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: u.id, email: u.email, scopeType: 'platform' });
    expect(res.body.user.permissions).toContain('customer.manage');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(REFRESH_COOKIE));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);

    const me = await t.http.get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(u.email);
  });

  it('matches email case-insensitively', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    expect((await login(t, u.email.toUpperCase(), u.password)).status).toBe(200);
  });

  it('rejects requests without a token', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('wrong password → 401 INVALID_CREDENTIALS; 5 failures → 423 with retryAfterSeconds ≈ 900', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    for (let i = 0; i < 4; i++) {
      const res = await login(t, u.email, 'wrong-password!');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await login(t, u.email, 'wrong-password!');
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.details.retryAfterSeconds).toBeGreaterThan(890);
    expect(fifth.body.details.retryAfterSeconds).toBeLessThanOrEqual(900);
    // Even the correct password is refused while locked.
    expect((await login(t, u.email, u.password)).status).toBe(423);
  });

  it('unknown email → 401 INVALID_CREDENTIALS', async () => {
    const res = await login(t, 'nobody@example.com', 'whatever-password');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('disabled user cannot log in', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin', status: 'disabled' });
    expect((await login(t, u.email, u.password)).status).toBe(401);
  });

  it('refresh rotates; reusing old refresh token revokes family', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const first = refreshCookie(await login(t, u.email, u.password))!;

    const r1 = await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', first);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toEqual(expect.any(String));
    const second = refreshCookie(r1)!;
    expect(second).not.toBe(first);

    const reuse = await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', first);
    expect(reuse.status).toBe(401);

    const afterReuse = await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', second);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the session and its access token', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const res = await login(t, u.email, u.password);
    const cookie = refreshCookie(res)!;
    const auth = `Bearer ${res.body.accessToken}`;
    const out = await request(t.app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', auth);
    expect(out.status).toBe(204);
    expect((await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await t.http.get('/api/auth/me').set('Authorization', auth)).status).toBe(401);
  });

  it('forgot for unknown email → 202 and Mailpit receives nothing', async () => {
    const ghost = `ghost-${Date.now()}@example.com`;
    const res = await t.http.post('/api/auth/forgot').set('Host', 'localhost').send({ email: ghost });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({});
    await new Promise((r) => setTimeout(r, 1000));
    expect(await listMail(ghost)).toHaveLength(0);
  });

  describe('cross-subdomain account confusion (Review Focus 5)', () => {
    it('customer B user logging in on customer A host → 401 INVALID_CREDENTIALS', async () => {
      const a = await createCustomer(t.db);
      const b = await createCustomer(t.db);
      const ub = await createUser(t.db, { roleKey: 'customer_admin', customerId: b.id });
      const res = await login(t, ub.email, ub.password, { host: `${a.slug}.localhost` });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect((await login(t, ub.email, ub.password, { host: `${b.slug}.localhost` })).status).toBe(200);
    });

    it('platform user on customer host → 401', async () => {
      const a = await createCustomer(t.db);
      const p = await createUser(t.db, { roleKey: 'platform_admin' });
      const res = await login(t, p.email, p.password, { host: `${a.slug}.localhost` });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('customer user on platform host → 401', async () => {
      const a = await createCustomer(t.db);
      const ua = await createUser(t.db, { roleKey: 'customer_admin', customerId: a.id });
      expect((await login(t, ua.email, ua.password)).status).toBe(401);
    });

    it('forgot for customer B user on customer A host → 202 and no email', async () => {
      const a = await createCustomer(t.db);
      const b = await createCustomer(t.db);
      const ub = await createUser(t.db, { roleKey: 'customer_admin', customerId: b.id });
      const res = await t.http.post('/api/auth/forgot').set('Host', `${a.slug}.localhost`).send({ email: ub.email });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({});
      await new Promise((r) => setTimeout(r, 1000));
      expect(await listMail(ub.email)).toHaveLength(0);
    });
  });

  it('forgot sends a reset link on the customer subdomain; reset works once', async () => {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const res = await t.http.post('/api/auth/forgot').set('Host', `${c.slug}.localhost`).send({ email: u.email });
    expect(res.status).toBe(202);
    const msg = await waitForMail(u.email);
    const text = await mailText(msg.ID);
    const link = /https?:\/\/\S+\/reset\?token=([A-Za-z0-9_-]+)/.exec(text);
    expect(link?.[0]).toContain(`${c.slug}.localhost`);
    const token = link![1]!;

    // Sign in first so we can check that the reset revokes existing sessions.
    const before = refreshCookie(await login(t, u.email, u.password, { host: `${c.slug}.localhost` }))!;

    const reset = await t.http.post('/api/auth/reset').send({ token, password: 'brand-new-password' });
    expect(reset.status).toBe(200);
    expect((await login(t, u.email, 'brand-new-password', { host: `${c.slug}.localhost` })).status).toBe(200);
    expect((await request(t.app.getHttpServer()).post('/api/auth/refresh').set('Cookie', before)).status).toBe(401);

    const again = await t.http.post('/api/auth/reset').send({ token, password: 'another-password' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('TOKEN_INVALID');

    await waitForMail(u.email); // password_changed notice also arrives
  });

  it('reset token older than 1 h → TOKEN_INVALID', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const token = await t.app.get(TokenService).issue(u.id, 'reset');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    const res = await t.http.post('/api/auth/reset').send({ token, password: 'brand-new-password' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('invite token valid 72 h then invalid', async () => {
    const valid = await createUser(t.db, { roleKey: 'platform_admin', status: 'invited' });
    const expired = await createUser(t.db, { roleKey: 'platform_admin', status: 'invited' });
    const tokens = t.app.get(TokenService);
    const validToken = await tokens.issue(valid.id, 'invite');
    const expiredToken = await tokens.issue(expired.id, 'invite');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 71 * 60 * 60 * 1000);
    const ok = await t.http.post('/api/auth/activate').send({ token: validToken, password: 'activated-password' });
    expect(ok.status).toBe(200);
    const row = await t.db.query.user.findFirst({ where: eq(user.id, valid.id) });
    expect(row?.status).toBe('active');

    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    const late = await t.http.post('/api/auth/activate').send({ token: expiredToken, password: 'activated-password' });
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('TOKEN_INVALID');
  });

  it('TOTP: enable then login without code → 401 TOTP_REQUIRED; with valid code → 200', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password)}`;
    const setup = await t.http.post('/api/auth/totp/setup').set('Authorization', auth);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.body.secret as string;

    expect((await t.http.post('/api/auth/totp/enable').set('Authorization', auth).send({ code: '000000' })).status).toBe(
      400,
    );
    const enable = await t.http.post('/api/auth/totp/enable').set('Authorization', auth).send({ code: totpCode(secret) });
    expect(enable.status).toBe(200);

    const noCode = await login(t, u.email, u.password);
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('TOTP_REQUIRED');

    const badCode = await login(t, u.email, u.password, { totp: '000000' });
    expect(badCode.status).toBe(401);
    expect(badCode.body.code).toBe('INVALID_CREDENTIALS');

    const withCode = await login(t, u.email, u.password, { totp: totpCode(secret) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.user.totpEnabled).toBe(true);
  });

  it('super admin without TOTP is limited to auth endpoints', async () => {
    const u = await createUser(t.db, { roleKey: 'super_admin' });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password)}`;
    expect((await t.http.get('/api/auth/me').set('Authorization', auth)).status).toBe(200);
    const blocked = await t.http.get('/api/settings/email').set('Authorization', auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'TOTP_REQUIRED', details: { setup: true } });
  });

  it('password shorter than 10 → 400 VALIDATION', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin', status: 'invited' });
    const token = await t.app.get(TokenService).issue(u.id, 'invite');
    const res = await t.http.post('/api/auth/activate').send({ token, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    // The token was not consumed by the failed attempt.
    expect((await t.http.post('/api/auth/activate').send({ token, password: 'long-enough-pw' })).status).toBe(200);
  });

  it('stores only hashed refresh tokens', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const cookie = refreshCookie(await login(t, u.email, u.password))!;
    const raw = decodeURIComponent(cookie.split('=')[1]!);
    const rows = await t.db.query.session.findMany({ where: eq(session.userId, u.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(raw);
  });
});

describe('auth rate limiting', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ overrides: { AUTH_RATE_LIMIT_PER_MIN: '10' } });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('limits /login to 10 requests per minute per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(t, 'x@example.com', 'whatever-pass')).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

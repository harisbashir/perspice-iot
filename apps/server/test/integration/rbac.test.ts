import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKey, customer, role } from '../../src/db/schema';
import { login, tokenFor } from '../auth-helpers';
import { createCustomer, createUser, ensureRole } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, mailText, waitForMail } from '../mailpit';

const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

describe('rbac', () => {
  let t: TestApp;
  let platformAuth: string;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function customerUser(roleKey: 'customer_admin' | 'customer_viewer', customerId?: string) {
    const c = customerId
      ? (await t.db.query.customer.findFirst({ where: eq(customer.id, customerId) }))!
      : await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey, customerId: c.id });
    return { c, u, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  const roleId = async (key: 'customer_admin' | 'customer_viewer' | 'platform_admin') =>
    (await ensureRole(t.db, key)).id;

  it('seeds built-in roles on startup', async () => {
    const rows = await t.db.select().from(role).where(eq(role.builtIn, true));
    expect(rows.map((r) => r.key).sort()).toEqual([
      'customer_admin',
      'customer_operator',
      'customer_viewer',
      'platform_admin',
      'super_admin',
      'support',
    ]);
  });

  it('viewer calling POST /users/invite → 403', async () => {
    const { auth } = await customerUser('customer_viewer');
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email: unique('v'), name: 'X', roleId: await roleId('customer_viewer') });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('customer admin inviting customer_admin succeeds and the invite email activates the account', async () => {
    const { c, auth } = await customerUser('customer_admin');
    const email = unique('invitee');
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email, name: 'New Admin', roleId: await roleId('customer_admin') });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email, status: 'invited', customerId: c.id, scopeType: 'customer' });
    expect(res.body.passwordHash).toBeUndefined();

    const msg = await waitForMail(email);
    const token = /\/activate\?token=([A-Za-z0-9_-]+)/.exec(await mailText(msg.ID))![1]!;
    expect((await t.http.post('/api/auth/activate').send({ token, password: 'activated-pass' })).status).toBe(200);
    expect((await login(t, email, 'activated-pass', { host: `${c.slug}.localhost` })).status).toBe(200);
  });

  it('the invite returns its activation link, for admins to pass on when email is not set up', async () => {
    const { c, auth } = await customerUser('customer_admin');
    const email = unique('linked');
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email, name: 'Linked', roleId: await roleId('customer_viewer') });
    expect(res.status).toBe(201);
    const link = res.body.inviteLink as string;
    expect(link).toMatch(new RegExp(`^https?://${c.slug}\\.[^/]+/activate\\?token=[A-Za-z0-9_-]+$`));
    const token = new URL(link).searchParams.get('token')!;
    expect((await t.http.post('/api/auth/activate').send({ token, password: 'linked-pass-1' })).status).toBe(200);
    expect((await login(t, email, 'linked-pass-1', { host: `${c.slug}.localhost` })).status).toBe(200);
  });

  it('a new invite link replaces the earlier ones, and is only given for invited users in scope', async () => {
    const { c, auth } = await customerUser('customer_admin');
    const email = unique('relink');
    const invited = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email, name: 'Relink', roleId: await roleId('customer_viewer') });
    const first = new URL(invited.body.inviteLink).searchParams.get('token')!;

    const res = await t.http.post(`/api/users/${invited.body.id}/invite-link`).set('Authorization', auth);
    expect(res.status).toBe(201);
    expect(res.body.link).toMatch(new RegExp(`^https?://${c.slug}\\.`));
    const second = new URL(res.body.link).searchParams.get('token')!;
    expect(second).not.toBe(first);
    expect((await t.http.post('/api/auth/activate').send({ token: first, password: 'relink-pass-1' })).status).toBe(400);

    // Others can't mint links: a viewer, or an admin of another customer.
    const viewer = await customerUser('customer_viewer', c.id);
    expect((await t.http.post(`/api/users/${invited.body.id}/invite-link`).set('Authorization', viewer.auth)).status).toBe(403);
    const other = await customerUser('customer_admin');
    expect((await t.http.post(`/api/users/${invited.body.id}/invite-link`).set('Authorization', other.auth)).status).toBe(404);

    expect((await t.http.post('/api/auth/activate').send({ token: second, password: 'relink-pass-1' })).status).toBe(200);
    // Once active there is nothing to invite.
    expect((await t.http.post(`/api/users/${invited.body.id}/invite-link`).set('Authorization', auth)).status).toBe(409);
  });

  it('customer admin inviting platform_admin → 403', async () => {
    const { auth } = await customerUser('customer_admin');
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email: unique('p'), name: 'X', roleId: await roleId('platform_admin') });
    expect(res.status).toBe(403);
  });

  it('customer admin inviting into another customer → 404', async () => {
    const { auth } = await customerUser('customer_admin');
    const other = await createCustomer(t.db);
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email: unique('x'), name: 'X', roleId: await roleId('customer_viewer'), customerId: other.id });
    expect(res.status).toBe(404);
  });

  it('duplicate email → 409', async () => {
    const { auth } = await customerUser('customer_admin');
    const existing = await createUser(t.db, { roleKey: 'platform_admin' });
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ email: existing.email.toUpperCase(), name: 'X', roleId: await roleId('customer_viewer') });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('platform admin invites a customer user into a chosen customer', async () => {
    const c = await createCustomer(t.db);
    const res = await t.http
      .post('/api/users/invite')
      .set('Authorization', platformAuth)
      .send({ email: unique('pc'), name: 'X', roleId: await roleId('customer_viewer'), customerId: c.id });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(c.id);
    const missing = await t.http
      .post('/api/users/invite')
      .set('Authorization', platformAuth)
      .send({ email: unique('pc'), name: 'X', roleId: await roleId('customer_viewer') });
    expect(missing.status).toBe(400);
  });

  it('customer admin cannot disable themselves or change their own role', async () => {
    const { u, auth } = await customerUser('customer_admin');
    expect(
      (await t.http.patch(`/api/users/${u.id}`).set('Authorization', auth).send({ status: 'disabled' })).status,
    ).toBe(403);
    expect((await t.http.patch(`/api/users/${u.id}`).set('Authorization', auth).send({ name: 'Renamed' })).status).toBe(
      200,
    );
  });

  describe('customers', () => {
    it('rejects reserved and malformed slugs', async () => {
      for (const slug of ['admin', 'www', 'Bad_Slug', 'ab']) {
        const res = await t.http.post('/api/customers').set('Authorization', platformAuth).send({ name: 'X', slug });
        expect(res.status).toBe(400);
      }
    });

    it('creates, renames and refuses a duplicate slug', async () => {
      const slug = `acme-${Date.now()}`;
      const res = await t.http.post('/api/customers').set('Authorization', platformAuth).send({ name: 'Acme', slug });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Acme', slug, status: 'active' });
      const dup = await t.http.post('/api/customers').set('Authorization', platformAuth).send({ name: 'A2', slug });
      expect(dup.status).toBe(409);
      const patched = await t.http
        .patch(`/api/customers/${res.body.id}`)
        .set('Authorization', platformAuth)
        .send({ name: 'Acme Ltd' });
      expect(patched.body.name).toBe('Acme Ltd');
    });

    it('customer admin cannot manage customers', async () => {
      const { auth } = await customerUser('customer_admin');
      const res = await t.http.post('/api/customers').set('Authorization', auth).send({ name: 'X', slug: 'xyz-abc' });
      expect(res.status).toBe(403);
    });

    it('suspending a customer blocks login on its subdomain', async () => {
      const { c, u } = await customerUser('customer_admin');
      await t.http.patch(`/api/customers/${c.id}`).set('Authorization', platformAuth).send({ status: 'suspended' });
      expect((await login(t, u.email, u.password, { host: `${c.slug}.localhost` })).status).toBe(401);
    });

    it('manages nested groups and rejects a parent from another customer', async () => {
      const { c, auth } = await customerUser('customer_admin');
      const parent = await t.http.post(`/api/customers/${c.id}/groups`).set('Authorization', auth).send({ name: 'North' });
      expect(parent.status).toBe(201);
      const child = await t.http
        .post(`/api/customers/${c.id}/groups`)
        .set('Authorization', auth)
        .send({ name: 'Site 1', parentId: parent.body.id });
      expect(child.body.parentId).toBe(parent.body.id);
      const cycle = await t.http
        .patch(`/api/customers/${c.id}/groups/${parent.body.id}`)
        .set('Authorization', auth)
        .send({ parentId: child.body.id });
      expect(cycle.status).toBe(400);

      const other = await customerUser('customer_admin');
      const foreignParent = await t.http
        .post(`/api/customers/${other.c.id}/groups`)
        .set('Authorization', other.auth)
        .send({ name: 'Theirs' });
      const bad = await t.http
        .post(`/api/customers/${c.id}/groups`)
        .set('Authorization', auth)
        .send({ name: 'X', parentId: foreignParent.body.id });
      expect(bad.status).toBe(404);
    });
  });

  describe('roles', () => {
    it('built-in roles are immutable', async () => {
      const id = await roleId('customer_viewer');
      const res = await t.http.patch(`/api/roles/${id}`).set('Authorization', platformAuth).send({ name: 'X' });
      expect(res.status).toBe(403);
    });

    it('customer-scope custom roles cannot include platform permissions', async () => {
      const res = await t.http
        .post('/api/roles')
        .set('Authorization', platformAuth)
        .send({ name: 'Bad', scope: 'customer', permissions: ['device.read', 'customer.manage'] });
      expect(res.status).toBe(400);
      const ok = await t.http
        .post('/api/roles')
        .set('Authorization', platformAuth)
        .send({ name: 'Field tech', scope: 'customer', permissions: ['device.read', 'device.command'] });
      expect(ok.status).toBe(201);
    });

    it('customer users only see customer-scope roles', async () => {
      const { auth } = await customerUser('customer_admin');
      const res = await t.http.get('/api/roles').set('Authorization', auth);
      expect(res.status).toBe(200);
      expect((res.body as { scope: string }[]).every((r) => r.scope === 'customer')).toBe(true);
    });
  });

  describe('api keys', () => {
    it('rejects a key with a permission the creator lacks', async () => {
      const { auth } = await customerUser('customer_viewer');
      const res = await t.http
        .post('/api/api-keys')
        .set('Authorization', auth)
        .send({ name: 'k', permissions: ['device.read', 'user.manage'] });
      expect(res.status).toBe(403);
    });

    it('created key authenticates; expired key → 401', async () => {
      const { auth } = await customerUser('customer_admin');
      const res = await t.http
        .post('/api/api-keys')
        .set('Authorization', auth)
        .send({ name: 'integration', permissions: ['user.read'] });
      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^pk_[A-Za-z0-9_-]{43}$/);

      const keyAuth = `Bearer ${res.body.key}`;
      expect((await t.http.get('/api/users').set('Authorization', keyAuth)).status).toBe(200);
      // The key only carries the permissions it was created with.
      expect(
        (await t.http.post('/api/users/invite').set('Authorization', keyAuth).send({ email: unique('k'), name: 'x', roleId: await roleId('customer_viewer') }))
          .status,
      ).toBe(403);

      await t.db.update(apiKey).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiKey.id, res.body.id));
      expect((await t.http.get('/api/users').set('Authorization', keyAuth)).status).toBe(401);
    });

    it('lists keys without secrets and deletes them', async () => {
      const { auth } = await customerUser('customer_admin');
      const created = await t.http.post('/api/api-keys').set('Authorization', auth).send({ name: 'tmp', permissions: [] });
      const list = await t.http.get('/api/api-keys').set('Authorization', auth);
      expect(list.body.map((k: { id: string }) => k.id)).toContain(created.body.id);
      expect(JSON.stringify(list.body)).not.toContain(created.body.key);
      expect((await t.http.delete(`/api/api-keys/${created.body.id}`).set('Authorization', auth)).status).toBe(204);
      expect((await t.http.get('/api/users').set('Authorization', `Bearer ${created.body.key}`)).status).toBe(401);
    });
  });
});

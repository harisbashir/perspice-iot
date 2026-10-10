import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { TENANT_ENDPOINTS, type TenantContext, type TenantSide } from '../tenant-endpoints';

describe('tenant isolation', () => {
  let t: TestApp;
  let ctx: TenantContext;

  async function side(t: TestApp): Promise<TenantSide> {
    const customer = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: customer.id });
    return {
      customer,
      admin,
      auth: `Bearer ${await tokenFor(t, admin.email, admin.password, `${customer.slug}.localhost`)}`,
    };
  }

  beforeAll(async () => {
    t = await createTestApp();
    ctx = { t, a: await side(t), b: await side(t) };
  });

  afterAll(async () => {
    await t?.close();
  });

  it('covers at least one endpoint', () => {
    expect(TENANT_ENDPOINTS.length).toBeGreaterThan(0);
  });

  describe.each(TENANT_ENDPOINTS)('$name', (ep) => {
    it(ep.method === 'list' ? "never lists customer B's objects" : "returns 404 for customer B's object", async () => {
      const ids = await ep.create(ctx);
      expect(Object.values(ids).every(Boolean)).toBe(true);
      const path = ep.path(ids);
      if (ep.method === 'list') {
        const res = await t.http.get(path).set('Authorization', ctx.a.auth);
        expect(res.status).toBe(200);
        const body = JSON.stringify(res.body);
        for (const id of Object.values(ids)) expect(body).not.toContain(id);
        return;
      }
      let req = t.http[ep.method](path).set('Authorization', ctx.a.auth);
      if (ep.body) req = req.send(ep.body(ids) as object);
      const res = await req;
      expect(res.status, `${ep.method.toUpperCase()} ${path} → ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});

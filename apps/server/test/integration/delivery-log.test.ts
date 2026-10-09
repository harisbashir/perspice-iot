import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryLog } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('delivery log', () => {
  let t: TestApp;
  let platform: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant() {
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const [dead] = await t.db
      .insert(deliveryLog)
      .values({ channel: 'inapp', userId: admin.id, customerId: c.id, recipient: admin.email, subject: `For ${c.slug}`, payload: { message: { type: 'test', level: 'info', title: 'Hi', body: '', link: null, customerId: c.id }, recipient: { id: admin.id, email: admin.email, name: 'A', scopeType: 'customer', customerId: c.id, customerSlug: c.slug, timezone: 'UTC' } }, status: 'dead', attempts: 5, error: 'boom' })
      .returning();
    return { c, dead: dead!, auth: `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}` };
  }

  it('lists each customer its own deliveries and lets admins retry dead ones', async () => {
    const a = await tenant();
    const b = await tenant();
    const list = await t.http.get('/api/delivery-log?status=dead').set('Authorization', a.auth);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([a.dead.id]);
    expect((await t.http.post(`/api/delivery-log/${b.dead.id}/retry`).set('Authorization', a.auth)).status).toBe(404);

    const retry = await t.http.post(`/api/delivery-log/${a.dead.id}/retry`).set('Authorization', a.auth);
    expect(retry.status).toBe(202);
    let row = a.dead;
    for (let i = 0; i < 100 && row.status !== 'sent'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      row = (await t.db.query.deliveryLog.findFirst({ where: eq(deliveryLog.id, a.dead.id) }))!;
    }
    expect(row).toMatchObject({ status: 'sent', attempts: 1, error: null });
    expect((await t.http.post(`/api/delivery-log/${a.dead.id}/retry`).set('Authorization', a.auth)).status).toBe(409);

    const all = await t.http.get('/api/delivery-log').set('Authorization', platform);
    const ids = all.body.items.map((d: { id: string }) => d.id);
    expect(ids).toEqual(expect.arrayContaining([a.dead.id, b.dead.id]));
  });
});

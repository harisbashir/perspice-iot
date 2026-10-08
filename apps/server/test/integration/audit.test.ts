import { Body, Controller, Param, Post } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Audited } from '../../src/audit/audited.decorator';
import { AuditService } from '../../src/audit/audit.service';
import { auditLog } from '../../src/db/schema';
import { login, tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

@Controller('audit-test')
class AuditTestController {
  @Post(':id')
  @Audited('widget.update', 'widget')
  update(@Param('id') id: string, @Body() body: unknown) {
    return { id, body };
  }
}

describe('audit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [AuditTestController] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('records decorated handlers with secrets redacted', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password)}`;
    const res = await t.http
      .post('/api/audit-test/w-1')
      .set('Authorization', auth)
      .send({ name: 'x', password: 'p4ss', nested: { apiToken: 't', keep: 1 } });
    expect(res.status).toBe(201);

    const row = await t.db.query.auditLog.findFirst({
      where: and(eq(auditLog.action, 'widget.update'), eq(auditLog.targetId, 'w-1')),
    });
    expect(row).toMatchObject({ actorType: 'user', actorId: u.id, targetType: 'widget' });
    expect(row?.diff).toEqual({ name: 'x', password: '[redacted]', nested: { apiToken: '[redacted]', keep: 1 } });
    expect(row?.ip).toBeTruthy();
  });

  it('login failure produces auth.login_failed and success produces auth.login', async () => {
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    await login(t, u.email, 'wrong-password!');
    await login(t, u.email, u.password);
    const rows = await t.db.query.auditLog.findMany({ where: eq(auditLog.actorId, u.id) });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('auth.login_failed');
    expect(actions).toContain('auth.login');
  });

  it('customer user listing sees only own-customer rows', async () => {
    const a = await createCustomer(t.db);
    const b = await createCustomer(t.db);
    const audit = t.app.get(AuditService);
    const base = { actorType: 'system' as const, actorId: null, targetType: 'device', targetId: null };
    await audit.record({ ...base, customerId: a.id, action: 'test.a' });
    await audit.record({ ...base, customerId: b.id, action: 'test.b' });
    await audit.record({ ...base, customerId: null, action: 'test.platform' });

    const ua = await createUser(t.db, { roleKey: 'customer_admin', customerId: a.id });
    const auth = `Bearer ${await tokenFor(t, ua.email, ua.password, `${a.slug}.localhost`)}`;
    const res = await t.http.get('/api/audit').set('Authorization', auth);
    expect(res.status).toBe(200);
    const actions = (res.body.items as { action: string; customerId: string }[]).map((i) => i.action);
    expect(actions).toContain('test.a');
    expect(actions).not.toContain('test.b');
    expect(actions).not.toContain('test.platform');
    expect((res.body.items as { customerId: string }[]).every((i) => i.customerId === a.id)).toBe(true);
  });

  it('pages with a cursor', async () => {
    const audit = t.app.get(AuditService);
    const c = await createCustomer(t.db);
    for (let i = 0; i < 5; i++) {
      await audit.record({
        actorType: 'system',
        actorId: null,
        customerId: c.id,
        action: `page.${i}`,
        targetType: 'x',
        targetId: 'paging',
      });
      await new Promise((r) => setTimeout(r, 2)); // distinct timestamps → deterministic order
    }
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    const auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const first = await t.http.get('/api/audit?targetType=x&targetId=paging&limit=3').set('Authorization', auth);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await t.http
      .get(`/api/audit?targetType=x&targetId=paging&limit=3&cursor=${first.body.nextCursor}`)
      .set('Authorization', auth);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items].map((i: { action: string }) => i.action);
    expect(all).toEqual(['page.4', 'page.3', 'page.2', 'page.1', 'page.0']);
  });
});

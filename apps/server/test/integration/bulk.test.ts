import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, command, device } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('bulk device operations', () => {
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

  async function tenant(role: 'customer_admin' | 'customer_operator' | 'customer_viewer' = 'customer_admin') {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: role, customerId: c.id });
    return { c, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  async function devices(n: number, customerId: string | null, tags: string[] = []) {
    const profile = await createProfile(t.db, { commands: [{ name: 'reboot', label: 'Reboot', confirm: false }] });
    const out = [];
    for (let i = 0; i < n; i++) out.push((await createDevice(t.db, { profileId: profile.id, customerId, tags })).device);
    return out;
  }

  const bulk = (auth: string, body: object) => t.http.post('/api/devices/bulk').set('Authorization', auth).send(body);
  const rows = (ids: string[]) => t.db.select().from(device).where(inArray(device.id, ids));

  it('adds and removes tags, keeping the others', async () => {
    const a = await tenant();
    const ds = await devices(3, a.c.id, ['old', 'keep']);
    const res = await bulk(a.auth, { deviceIds: ds.map((d) => d.id), action: { kind: 'tags', add: ['north', 'keep'], remove: ['old'] } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: 3 });
    for (const r of await rows(ds.map((d) => d.id))) expect([...r.tags].sort()).toEqual(['keep', 'north']);
  });

  it("never touches another customer's devices, even when listed", async () => {
    const a = await tenant();
    const b = await tenant();
    const mine = await devices(2, a.c.id);
    const theirs = await devices(1, b.c.id);
    const res = await bulk(a.auth, { deviceIds: [...mine.map((d) => d.id), theirs[0]!.id], action: { kind: 'tags', add: ['x'], remove: [] } });
    expect(res.body.ok).toBe(2);
    expect(res.body.results.find((r: { deviceId: string }) => r.deviceId === theirs[0]!.id)).toEqual({ deviceId: theirs[0]!.id, ok: false, error: 'Not found' });
    expect((await rows([theirs[0]!.id]))[0]!.tags).toEqual([]);
  });

  it('assigns devices to a customer (platform only)', async () => {
    const a = await tenant();
    const ds = await devices(2, null);
    expect((await bulk(a.auth, { deviceIds: ds.map((d) => d.id), action: { kind: 'assign', customerId: a.c.id } })).status).toBe(403);
    const res = await bulk(platform, { deviceIds: ds.map((d) => d.id), action: { kind: 'assign', customerId: a.c.id } });
    expect(res.body.ok).toBe(2);
    for (const r of await rows(ds.map((d) => d.id))) expect(r.customerId).toBe(a.c.id);
  });

  it('moves devices into a group of their customer', async () => {
    const a = await tenant();
    const group = (await t.http.post(`/api/customers/${a.c.id}/groups`).set('Authorization', platform).send({ name: 'North' })).body;
    const ds = await devices(2, a.c.id);
    const res = await bulk(a.auth, { deviceIds: ds.map((d) => d.id), action: { kind: 'group', groupId: group.id } });
    expect(res.body.ok).toBe(2);
    for (const r of await rows(ds.map((d) => d.id))) expect(r.groupId).toBe(group.id);
  });

  it('sends a command to every device, with per-device results', async () => {
    const a = await tenant('customer_operator');
    const ds = await devices(2, a.c.id);
    const res = await bulk(a.auth, { deviceIds: ds.map((d) => d.id), action: { kind: 'command', name: 'reboot', params: {} } });
    expect(res.body.ok).toBe(2);
    const sent = await t.db.select().from(command).where(inArray(command.deviceId, ds.map((d) => d.id)));
    expect(sent.map((c) => c.name)).toEqual(['reboot', 'reboot']);
    const unknown = await bulk(a.auth, { deviceIds: [ds[0]!.id], action: { kind: 'command', name: 'self_destruct', params: {} } });
    expect(unknown.body.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/command/i) });
  });

  it('needs the permission of the action', async () => {
    const v = await tenant('customer_viewer');
    const ds = await devices(1, v.c.id);
    expect((await bulk(v.auth, { deviceIds: [ds[0]!.id], action: { kind: 'tags', add: ['x'], remove: [] } })).status).toBe(403);
    expect((await bulk(v.auth, { deviceIds: [ds[0]!.id], action: { kind: 'delete' } })).status).toBe(403);
  });

  it('deletes devices and records one audit entry with the ids', async () => {
    const a = await tenant();
    const ds = await devices(2, a.c.id);
    const res = await bulk(a.auth, { deviceIds: ds.map((d) => d.id), action: { kind: 'delete' } });
    expect(res.body.ok).toBe(2);
    expect(await rows(ds.map((d) => d.id))).toHaveLength(0);
    const audit = await t.db.query.auditLog.findFirst({ where: eq(auditLog.action, 'device.bulk_delete') });
    expect(audit?.diff).toMatchObject({ deviceIds: expect.arrayContaining(ds.map((d) => d.id)), ok: 2 });
  });
});

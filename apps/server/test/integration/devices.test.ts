import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device } from '../../src/db/schema';
import { CredentialsService } from '../../src/devices/credentials.service';
import { DebugLogService } from '../../src/devices/debug-log.service';
import { sha256Hex } from '../../src/common/crypto';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('devices', () => {
  let t: TestApp;
  let platformAuth: string;
  let profileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db)).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function customerAuth(roleKey: 'customer_admin' | 'customer_viewer', customerId: string, slug: string) {
    const u = await createUser(t.db, { roleKey, customerId });
    return `Bearer ${await tokenFor(t, u.email, u.password, `${slug}.localhost`)}`;
  }

  async function readEvents(): Promise<{ type: string; deviceId: string }[]> {
    const entries = (await t.redis.xrange('events:device', '-', '+')) as [string, string[]][];
    return entries.map(([, fields]) => JSON.parse(fields[1]!) as { type: string; deviceId: string });
  }

  describe('profiles', () => {
    it('validates timeouts and key names', async () => {
      const bad = await t.http
        .post('/api/device-profiles')
        .set('Authorization', platformAuth)
        .send({ name: 'Bad', offlineTimeoutS: 600, deadTimeoutS: 600 });
      expect(bad.status).toBe(400);
      const badKey = await t.http
        .post('/api/device-profiles')
        .set('Authorization', platformAuth)
        .send({ name: 'Bad', telemetrySchema: [{ key: 'a/b', label: 'x', type: 'number' }] });
      expect(badKey.status).toBe(400);
    });

    it('creates with defaults and updates', async () => {
      const res = await t.http
        .post('/api/device-profiles')
        .set('Authorization', platformAuth)
        .send({
          name: 'Telecom RMS',
          telemetrySchema: [{ key: 'fuel_level', label: 'Fuel', unit: '%', type: 'number', decimals: 1 }],
          commands: [{ name: 'gen_start', label: 'Start generator', confirm: true }],
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ offlineTimeoutS: 300, deadTimeoutS: 86400, transport: 'mqtt', sleepy: false });
      const patched = await t.http
        .patch(`/api/device-profiles/${res.body.id}`)
        .set('Authorization', platformAuth)
        .send({ deadTimeoutS: 100 });
      expect(patched.status).toBe(400);
    });

    it('customer admins cannot write profiles', async () => {
      const c = await createCustomer(t.db);
      const auth = await customerAuth('customer_admin', c.id, c.slug);
      expect((await t.http.post('/api/device-profiles').set('Authorization', auth).send({ name: 'x' })).status).toBe(403);
    });
  });

  it('create device returns a pdt_ token of length 47 and stores only its hash', async () => {
    const res = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Gen-1', profileId });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^pdt_[A-Za-z0-9_-]{43}$/);
    expect(res.body.token).toHaveLength(47);
    expect(res.body.device).toMatchObject({ name: 'Gen-1', status: 'never', profileId });
    const row = await t.db.query.device.findFirst({ where: eq(device.id, res.body.device.id) });
    expect(row?.credentialsHash).toBe(sha256Hex(res.body.token));
    expect(JSON.stringify(row)).not.toContain(res.body.token);
    expect(await t.app.get(CredentialsService).verifyToken(row!.id, res.body.token)).toBe(true);
  });

  it('regenerate invalidates the old token and emits credentials_changed', async () => {
    const created = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'R', profileId });
    const id = created.body.device.id as string;
    const creds = t.app.get(CredentialsService);
    expect(await creds.verifyToken(id, created.body.token)).toBe(true);
    const regen = await t.http.post(`/api/devices/${id}/credentials/regenerate`).set('Authorization', platformAuth);
    expect(regen.status).toBe(201);
    expect(regen.body.token).not.toBe(created.body.token);
    expect(await creds.verifyToken(id, created.body.token)).toBe(false);
    expect(await creds.verifyToken(id, regen.body.token)).toBe(true);
    expect(await creds.findByToken(regen.body.token)).toMatchObject({ id });
    expect(await creds.findByToken(created.body.token)).toBeNull();
    expect(await readEvents()).toContainEqual(expect.objectContaining({ type: 'device.credentials_changed', deviceId: id }));
  });

  it('disabled devices fail token verification', async () => {
    const created = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'D', profileId });
    const id = created.body.device.id as string;
    await t.http.patch(`/api/devices/${id}`).set('Authorization', platformAuth).send({ disabled: true });
    expect(await t.app.get(CredentialsService).verifyToken(id, created.body.token)).toBe(false);
  });

  it('customer viewer cannot create devices', async () => {
    const c = await createCustomer(t.db);
    const auth = await customerAuth('customer_viewer', c.id, c.slug);
    expect((await t.http.post('/api/devices').set('Authorization', auth).send({ name: 'x', profileId })).status).toBe(403);
  });

  it('customer admin edits name/tags but cannot reassign the customer', async () => {
    const c = await createCustomer(t.db);
    const other = await createCustomer(t.db);
    const created = await t.http
      .post('/api/devices')
      .set('Authorization', platformAuth)
      .send({ name: 'Site', profileId, customerId: c.id });
    const id = created.body.device.id as string;
    const auth = await customerAuth('customer_admin', c.id, c.slug);
    const ok = await t.http.patch(`/api/devices/${id}`).set('Authorization', auth).send({ name: 'Renamed', tags: ['north'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed', tags: ['north'] });
    expect((await t.http.patch(`/api/devices/${id}`).set('Authorization', auth).send({ customerId: other.id })).status).toBe(403);
    expect((await t.http.patch(`/api/devices/${id}`).set('Authorization', auth).send({ offlineTimeoutS: 60 })).status).toBe(403);
  });

  it('customers see only their devices and the profiles those devices use', async () => {
    const c = await createCustomer(t.db);
    const ownProfile = await createProfile(t.db);
    const hiddenProfile = await createProfile(t.db);
    await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Mine', profileId: ownProfile.id, customerId: c.id });
    await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Unassigned', profileId: hiddenProfile.id });
    const auth = await customerAuth('customer_viewer', c.id, c.slug);
    const list = await t.http.get('/api/devices').set('Authorization', auth);
    expect(list.body.items.map((d: { name: string }) => d.name)).toEqual(['Mine']);
    const profiles = await t.http.get('/api/device-profiles').set('Authorization', auth);
    expect(profiles.body.map((p: { id: string }) => p.id)).toEqual([ownProfile.id]);
    expect((await t.http.get(`/api/device-profiles/${hiddenProfile.id}`).set('Authorization', auth)).status).toBe(404);
  });

  it('filters and paginates the device list', async () => {
    const p = await createProfile(t.db);
    for (const name of ['a1', 'a2', 'a3']) {
      await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name, profileId: p.id, tags: ['pg'] });
    }
    const first = await t.http.get(`/api/devices?profileId=${p.id}&limit=2`).set('Authorization', platformAuth);
    expect(first.body.items.map((d: { name: string }) => d.name)).toEqual(['a1', 'a2']);
    const second = await t.http
      .get(`/api/devices?profileId=${p.id}&limit=2&cursor=${first.body.nextCursor}`)
      .set('Authorization', platformAuth);
    expect(second.body.items.map((d: { name: string }) => d.name)).toEqual(['a3']);
    expect(second.body.nextCursor).toBeNull();
    const tagged = await t.http.get('/api/devices?tag=pg&search=a2').set('Authorization', platformAuth);
    expect(tagged.body.items.map((d: { name: string }) => d.name)).toEqual(['a2']);
  });

  it('deadTimeoutS <= offlineTimeoutS → 400', async () => {
    const res = await t.http
      .post('/api/devices')
      .set('Authorization', platformAuth)
      .send({ name: 'x', profileId, offlineTimeoutS: 600, deadTimeoutS: 300 });
    expect(res.status).toBe(400);
  });

  it('stores server and shared attributes and emits config_changed for shared', async () => {
    const created = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Attr', profileId });
    const id = created.body.device.id as string;
    expect(
      (await t.http.put(`/api/devices/${id}/attributes/server`).set('Authorization', platformAuth).send({ site: 'N-12' })).status,
    ).toBe(200);
    const shared = await t.http.put(`/api/devices/${id}/attributes/shared`).set('Authorization', platformAuth).send({ interval: 30 });
    expect(shared.status).toBe(200);
    expect(shared.body.attributes).toMatchObject({ server: { site: 'N-12' }, shared: { interval: 30 } });
    expect(await readEvents()).toContainEqual(expect.objectContaining({ type: 'device.config_changed', deviceId: id }));
  });

  it('delete emits device.deleted', async () => {
    const created = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Del', profileId });
    const id = created.body.device.id as string;
    expect((await t.http.delete(`/api/devices/${id}`).set('Authorization', platformAuth)).status).toBe(204);
    expect((await t.http.get(`/api/devices/${id}`).set('Authorization', platformAuth)).status).toBe(404);
    expect(await readEvents()).toContainEqual(expect.objectContaining({ type: 'device.deleted', deviceId: id }));
  });

  it('debug log keeps the newest 100 entries and truncates raw payloads', async () => {
    const created = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: 'Dbg', profileId });
    const id = created.body.device.id as string;
    const debug = t.app.get(DebugLogService);
    for (let i = 0; i < 105; i++) {
      await debug.push(id, { ts: i, kind: 'telemetry', summary: `msg ${i}`, raw: 'x'.repeat(5000) });
    }
    const res = await t.http.get(`/api/devices/${id}/debug`).set('Authorization', platformAuth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
    expect(res.body[0].summary).toBe('msg 104');
    expect(res.body[99].summary).toBe('msg 5');
    expect(res.body[0].raw.length).toBeLessThanOrEqual(2048);
  });

  it('counts devices by status within the caller scope', async () => {
    const c = await createCustomer(t.db);
    const p = await createProfile(t.db);
    for (const status of ['online', 'online', 'offline', 'never'] as const) {
      const res = await t.http.post('/api/devices').set('Authorization', platformAuth).send({ name: status, profileId: p.id, customerId: c.id });
      await t.db.update(device).set({ status }).where(eq(device.id, res.body.device.id));
    }
    const auth = await customerAuth('customer_viewer', c.id, c.slug);
    const stats = await t.http.get('/api/devices/stats').set('Authorization', auth);
    expect(stats.body).toEqual({ total: 4, online: 2, offline: 1, dead: 0, never: 1 });
  });
});

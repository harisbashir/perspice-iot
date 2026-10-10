import { CLAIM_ALPHABET } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, deviceClaim } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('claim codes', () => {
  let t: TestApp;
  let platform: string;
  let profileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    profileId = (await createProfile(t.db)).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function tenant(role: 'customer_admin' | 'customer_viewer' = 'customer_admin') {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: role, customerId: c.id });
    return { c, auth: `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}` };
  }

  const stock = async (name = 'Sensor') =>
    (await t.http.post('/api/devices').set('Authorization', platform).send({ name, profileId, withClaimCode: true })).body as {
      device: { id: string };
      token: string;
      claimCode: string;
    };
  const claim = (auth: string, body: object) => t.http.post('/api/devices/claim').set('Authorization', auth).send(body);

  it('issues a 12-character code once, keeping only its hash', async () => {
    const created = await stock();
    expect(created.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect([...created.claimCode.replace(/-/g, '')].every((ch) => CLAIM_ALPHABET.includes(ch))).toBe(true);
    const row = await t.db.query.deviceClaim.findFirst({ where: eq(deviceClaim.deviceId, created.device.id) });
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.claimCode.replace(/-/g, ''));
  });

  it('a customer claims the device: it joins their customer, renamed', async () => {
    const a = await tenant();
    const created = await stock();
    const res = await claim(a.auth, { code: created.claimCode.toLowerCase().replace(/-/g, ' '), name: 'Boiler room' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.device.id, name: 'Boiler room', customerId: a.c.id });
    expect((await t.http.get(`/api/devices/${created.device.id}`).set('Authorization', a.auth)).status).toBe(200);
  });

  it('codes are single-use, and wrong codes look the same', async () => {
    const a = await tenant();
    const b = await tenant();
    const created = await stock();
    expect((await claim(a.auth, { code: created.claimCode })).status).toBe(200);
    const again = await claim(b.auth, { code: created.claimCode });
    const wrong = await claim(b.auth, { code: 'ABCD-EFGH-JKMN' });
    expect(again.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(again.body.message).toBe(wrong.body.message);
    expect((await t.db.query.device.findFirst({ where: eq(device.id, created.device.id) }))!.customerId).toBe(a.c.id);
  });

  it('only for unassigned devices', async () => {
    const a = await tenant();
    const res = await t.http.post('/api/devices').set('Authorization', platform).send({ name: 'X', profileId, customerId: a.c.id, withClaimCode: true });
    expect(res.status).toBe(400);
  });

  it('a new code replaces the old one', async () => {
    const a = await tenant();
    const created = await stock();
    const renewed = await t.http.post(`/api/devices/${created.device.id}/claim-code`).set('Authorization', platform);
    expect(renewed.status).toBe(200);
    expect(renewed.body.claimCode).not.toBe(created.claimCode);
    expect((await claim(a.auth, { code: created.claimCode })).status).toBe(404);
    expect((await claim(a.auth, { code: renewed.body.claimCode })).status).toBe(200);
  });

  it('needs device.claim, and is rate limited against guessing', async () => {
    const v = await tenant('customer_viewer');
    expect((await claim(v.auth, { code: 'ABCD-EFGH-JKMN' })).status).toBe(403);
    const a = await tenant();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await claim(a.auth, { code: 'ABCD-EFGH-JKMN' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('rejects malformed codes', async () => {
    const a = await tenant();
    expect((await claim(a.auth, { code: '0000-0000-0000' })).status).toBe(400);
  });
});

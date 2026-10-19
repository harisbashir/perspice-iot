import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, device, provisioningKey } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('device provisioning', () => {
  let t: TestApp;
  let platform: string;
  let profileId: string;
  let profileName: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const profile = await createProfile(t.db, { name: 'Tank sensor' });
    profileId = profile.id;
    profileName = profile.name;
  });

  afterAll(async () => {
    await t?.close();
  });

  const newKey = async (body: Record<string, unknown> = {}, profile = profileId) => {
    const res = await t.http
      .post(`/api/device-profiles/${profile}/provisioning-keys`)
      .set('Authorization', platform)
      .send({ name: 'Factory', mode: 'create', ...body });
    expect(res.status).toBe(201);
    return res.body as { id: string; secret: string };
  };
  const provision = (body: Record<string, unknown>, ip = '203.0.113.1') =>
    t.http.post('/api/v1/device/provision').set('X-Forwarded-For', ip).send(body);
  const send = (token: string) => t.http.post('/api/v1/device/telemetry').set('X-Device-Token', token).send({ values: { level: 42 } });
  let serialN = 0;
  const serial = () => `AA:BB:CC:00:00:${String(++serialN).padStart(2, '0')}`;

  it('creates a key whose secret is shown once and stored only as a hash', async () => {
    const key = await newKey();
    expect(key.secret).toMatch(/^pps_/);
    const row = await t.db.query.provisioningKey.findFirst({ where: eq(provisioningKey.id, key.id) });
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(key.secret);
    const list = await t.http.get(`/api/device-profiles/${profileId}/provisioning-keys`).set('Authorization', platform);
    expect(list.body.find((k: { id: string }) => k.id === key.id)).toMatchObject({ name: 'Factory', mode: 'create', provisionedCount: 0 });
    expect(JSON.stringify(list.body)).not.toContain(key.secret);
  });

  it('only platform users with profile.write manage keys', async () => {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    expect((await t.http.post(`/api/device-profiles/${profileId}/provisioning-keys`).set('Authorization', auth).send({ name: 'x', mode: 'create' })).status).toBe(403);
    expect((await t.http.get(`/api/device-profiles/${profileId}/provisioning-keys`).set('Authorization', auth)).status).toBe(403);
  });

  it('a device with the key and its serial gets its own credentials, which work at once', async () => {
    const key = await newKey();
    const s = serial();
    const res = await provision({ key: key.secret, serial: s, attributes: { fw: '1.0.0' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ deviceId: expect.any(String), token: expect.stringMatching(/^pdt_/), mqtt: { host: 'mqtt.localhost', port: 8883, tls: true }, claimCode: null });
    const row = await t.db.query.device.findFirst({ where: eq(device.id, res.body.deviceId) });
    expect(row).toMatchObject({ name: `${profileName} ${s}`, serial: s, profileId, customerId: null });
    expect(row?.provisionedAt).toBeInstanceOf(Date);
    expect(row?.attributes.client).toMatchObject({ fw: '1.0.0' });
    expect((await send(res.body.token)).status).toBe(202);

    const audit = await t.db.query.auditLog.findFirst({ where: and(eq(auditLog.action, 'device.provision'), eq(auditLog.targetId, res.body.deviceId)) });
    expect(audit).toMatchObject({ actorType: 'device' });
    expect(JSON.stringify(audit)).not.toContain(key.secret);
    const listed = (await t.http.get(`/api/device-profiles/${profileId}/provisioning-keys`).set('Authorization', platform)).body.find((k: { id: string }) => k.id === key.id);
    expect(listed).toMatchObject({ provisionedCount: 1, lastUsedAt: expect.any(Number) });
  });

  it('a serial that already has credentials is refused, unless the key allows re-provisioning', async () => {
    const strict = await newKey();
    const s = serial();
    const first = await provision({ key: strict.secret, serial: s });
    expect((await provision({ key: strict.secret, serial: s })).status).toBe(409);
    expect((await send(first.body.token)).status).toBe(202);

    const lenient = await newKey({ allowReprovision: true });
    const again = await provision({ key: lenient.secret, serial: s });
    expect(again.status).toBe(201);
    expect(again.body.deviceId).toBe(first.body.deviceId);
    expect((await send(first.body.token)).status).toBe(401);
    expect((await send(again.body.token)).status).toBe(202);
  });

  it('a pre-registered key only accepts serials registered beforehand', async () => {
    const key = await newKey({ mode: 'preregistered' });
    expect((await provision({ key: key.secret, serial: serial() })).status).toBe(403);
    const s = serial();
    const registered = await t.http.post('/api/devices').set('Authorization', platform).send({ name: 'Tank 7', profileId, serial: s });
    expect(registered.status).toBe(201);
    const res = await provision({ key: key.secret, serial: s });
    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBe(registered.body.device.id);
    // The token from registration is replaced by the device's own.
    expect((await send(registered.body.token)).status).toBe(401);
    expect((await send(res.body.token)).status).toBe(202);
    expect((await t.http.post('/api/devices').set('Authorization', platform).send({ name: 'Dup', profileId, serial: s })).status).toBe(409);
  });

  it('places new devices in the key’s customer with its tags, or gives unassigned ones a claim code', async () => {
    const c = await createCustomer(t.db);
    const forCustomer = await newKey({ customerId: c.id, tags: ['batch-7'] });
    const placed = await provision({ key: forCustomer.secret, serial: serial(), name: 'North tank' });
    const row = await t.db.query.device.findFirst({ where: eq(device.id, placed.body.deviceId) });
    expect(row).toMatchObject({ name: 'North tank', customerId: c.id, tags: ['batch-7'] });
    expect(placed.body.claimCode).toBeNull();

    const stock = await newKey({ issueClaimCodes: true });
    const unassigned = await provision({ key: stock.secret, serial: serial() });
    expect(unassigned.body.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    const claimed = await t.http.post('/api/devices/claim').set('Authorization', auth).send({ code: unassigned.body.claimCode });
    expect(claimed.body).toMatchObject({ id: unassigned.body.deviceId, customerId: c.id });
  });

  it('refuses revoked, expired and unknown keys alike, and keys over their device limit', async () => {
    const limited = await newKey({ maxDevices: 1 });
    expect((await provision({ key: limited.secret, serial: serial() })).status).toBe(201);
    const over = await provision({ key: limited.secret, serial: serial() });
    expect(over.status).toBe(403);
    expect(over.body.message).toMatch(/limit/i);

    const revoked = await newKey();
    expect((await t.http.delete(`/api/provisioning-keys/${revoked.id}`).set('Authorization', platform)).status).toBe(204);
    const expired = await newKey({ expiresAt: Date.now() + 60_000 });
    await t.db.update(provisioningKey).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(provisioningKey.id, expired.id));
    const answers = await Promise.all([revoked.secret, expired.secret, 'pps_unknown-secret-value'].map((key) => provision({ key, serial: serial() })));
    expect(answers.map((a) => a.status)).toEqual([401, 401, 401]);
    expect(new Set(answers.map((a) => a.body.message)).size).toBe(1);
    const listed = (await t.http.get(`/api/device-profiles/${profileId}/provisioning-keys`).set('Authorization', platform)).body.find((k: { id: string }) => k.id === revoked.id);
    expect(listed.revokedAt).toEqual(expect.any(Number));
  });

  it('refuses AWS IoT profiles, whose devices use certificates', async () => {
    const aws = await createProfile(t.db, { transport: 'aws-iot' });
    const res = await t.http.post(`/api/device-profiles/${aws.id}/provisioning-keys`).set('Authorization', platform).send({ name: 'x', mode: 'create' });
    expect(res.status).toBe(400);
  });

  it('limits attempts per address', async () => {
    const answers = [];
    for (let i = 0; i < 31; i++) answers.push((await provision({ key: 'pps_nope-nope-nope', serial: 'X1' }, '198.51.100.9')).status);
    expect(answers.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(answers[30]).toBe(429);
  });
});

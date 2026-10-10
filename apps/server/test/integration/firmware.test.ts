import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE, type StorageDriver } from '../../src/storage/storage.driver';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('firmware images', () => {
  let t: TestApp;
  let platform: string;
  let customer: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platform = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    customer = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
  });

  afterAll(async () => {
    await t?.close();
  });

  const storage = () => t.app.get<StorageDriver>(STORAGE);

  const upload = (auth: string, profileId: string, version: string, body: Buffer, notes = '') =>
    t.http
      .post(`/api/firmware?profileId=${profileId}&version=${encodeURIComponent(version)}&notes=${encodeURIComponent(notes)}`)
      .set('Authorization', auth)
      .set('content-type', 'application/octet-stream')
      .send(body);

  it('stores an image with its size and SHA-256, and lists it for the profile', async () => {
    const profile = await createProfile(t.db);
    const image = randomBytes(300_000);
    const res = await upload(platform, profile.id, '1.3.0', image, 'Fixes the modem');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ profileId: profile.id, version: '1.3.0', size: 300_000, notes: 'Fixes the modem', sha256: createHash('sha256').update(image).digest('hex') });
    const list = await t.http.get(`/api/firmware?profileId=${profile.id}`).set('Authorization', platform);
    expect(list.body.map((f: { version: string }) => f.version)).toEqual(['1.3.0']);
  });

  it('refuses a second image with the same version, an empty image, and bad versions', async () => {
    const profile = await createProfile(t.db);
    expect((await upload(platform, profile.id, '2.0.0', randomBytes(1000))).status).toBe(201);
    expect((await upload(platform, profile.id, '2.0.0', randomBytes(1000))).status).toBe(409);
    expect((await upload(platform, profile.id, '2.0.1', Buffer.alloc(0))).status).toBe(400);
    expect((await upload(platform, profile.id, 'two point oh', randomBytes(10))).status).toBe(400);
  });

  it('refuses images over 16 MB and keeps nothing of them', async () => {
    const profile = await createProfile(t.db);
    const res = await upload(platform, profile.id, '9.9.9', Buffer.alloc(16 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect((await t.http.get(`/api/firmware?profileId=${profile.id}`).set('Authorization', platform)).body).toEqual([]);
    expect((await storage().list('firmware/')).length).toBe((await t.http.get('/api/firmware').set('Authorization', platform)).body.length);
  });

  it('hands out a signed download link that serves the same bytes', async () => {
    const profile = await createProfile(t.db);
    const image = randomBytes(50_000);
    const fw = (await upload(platform, profile.id, '3.0.0', image)).body;
    const link = await t.http.get(`/api/firmware/${fw.id}/download`).set('Authorization', platform);
    expect(link.status).toBe(200);
    const url = new URL(link.body.url, 'http://localhost');
    const bytes = await t.http.get(url.pathname + url.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(bytes.status).toBe(200);
    expect(Buffer.compare(bytes.body as Buffer, image)).toBe(0);
  });

  it('is managed by the platform only', async () => {
    const profile = await createProfile(t.db);
    expect((await upload(customer, profile.id, '1.0.0', randomBytes(10))).status).toBe(403);
    expect((await t.http.get('/api/firmware').set('Authorization', customer)).status).toBe(403);
  });

  it('deletes an image and its file', async () => {
    const profile = await createProfile(t.db);
    const fw = (await upload(platform, profile.id, '4.0.0', randomBytes(100))).body;
    expect((await t.http.delete(`/api/firmware/${fw.id}`).set('Authorization', platform)).status).toBe(204);
    expect((await t.http.get(`/api/firmware?profileId=${profile.id}`).set('Authorization', platform)).body).toEqual([]);
    expect(await storage().list(`firmware/${fw.id}`)).toEqual([]);
  });
});

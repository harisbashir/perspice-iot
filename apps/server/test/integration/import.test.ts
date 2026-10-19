import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, deviceClaim } from '../../src/db/schema';
import { CredentialsService } from '../../src/devices/credentials.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('CSV device import', () => {
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

  const unique = () => Math.random().toString(36).slice(2, 8);
  const upload = (csv: string, dryRun = false, auth = platform) =>
    t.http
      .post(`/api/devices/import${dryRun ? '?dryRun=true' : ''}`)
      .set('Authorization', auth)
      .set('Content-Type', 'text/csv')
      .send(csv);

  it('registers serials for provisioning: unique within the file and the profile', async () => {
    const profile = await createProfile(t.db, { name: `Tracker ${unique()}` });
    await t.db.insert(device).values({ name: 'Existing', profileId: profile.id, serial: 'SN-EXISTING', credentialsHash: `h-${unique()}` });
    const bad = await upload(
      ['name,profile,serial', `A,${profile.name},SN-1`, `B,${profile.name},SN-1`, `C,${profile.name},SN-EXISTING`, `D,${profile.name},bad serial`].join('\n'),
      true,
    );
    expect(bad.body.errors.map((e: { row: number; field: string }) => [e.row, e.field])).toEqual(
      expect.arrayContaining([
        [2, 'serial'],
        [3, 'serial'],
        [4, 'serial'],
      ]),
    );
    expect(bad.body.errors).toHaveLength(3);
    const ok = await upload(['name,profile,serial', `A,${profile.name},SN-1`, `B,${profile.name},SN-2`, `C,${profile.name},`].join('\n'));
    expect(ok.body.ok).toBe(true);
    const rows = await t.db.select().from(device).where(eq(device.profileId, profile.id));
    expect(rows.map((r) => r.serial).sort()).toEqual(['SN-1', 'SN-2', 'SN-EXISTING', null].sort());
  });

  it('dry run reports every bad row and creates nothing', async () => {
    const profile = await createProfile(t.db, { name: `Meter ${unique()}` });
    const csv = [
      'name,profile,customer,tags,lat,lng',
      `Good,${profile.name},,a;b,,`,
      `,${profile.name},,,,`,
      'No profile,Nope,,,,',
      `Bad tag,${profile.name},,a b,,`,
      `Half location,${profile.name},,,51.5,`,
      `Unknown customer,${profile.name},no-such-customer,,,`,
    ].join('\n');
    const res = await upload(csv, true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, rows: 6 });
    expect(res.body.errors.map((e: { row: number; field: string }) => [e.row, e.field])).toEqual([
      [2, 'name'],
      [3, 'profile'],
      [4, 'tags'],
      [5, 'lat'],
      [6, 'customer'],
    ]);
    expect(await t.db.select().from(device).where(eq(device.profileId, profile.id))).toHaveLength(0);
  });

  it('a file with errors creates nothing, even without the dry run', async () => {
    const profile = await createProfile(t.db, { name: `Meter ${unique()}` });
    const res = await upload(`name,profile\nGood,${profile.name}\nBad,Nope`);
    expect(res.status).toBe(400);
    expect(res.body.details.errors).toHaveLength(1);
    expect(await t.db.select().from(device).where(eq(device.profileId, profile.id))).toHaveLength(0);
  });

  it('imports devices with customers, groups, tags, locations and claim codes, returning credentials once', async () => {
    const profile = await createProfile(t.db, { name: `Tracker ${unique()}`, locationMode: 'fixed' });
    const c = await createCustomer(t.db);
    const group = (await t.http.post(`/api/customers/${c.id}/groups`).set('Authorization', platform).send({ name: 'Plant A' })).body;
    const csv = [
      'name,profile,customer,group,tags,lat,lng,claim',
      `Pump 1,${profile.name},${c.slug},Plant A,north;pump,51.5,-0.12,`,
      `Spare,${profile.id},,,,,,yes`,
    ].join('\r\n');
    const dry = await upload(csv, true);
    expect(dry.body).toEqual({ ok: true, rows: 2, errors: [] });

    const res = await upload(csv);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toHaveLength(2);
    const [pump, spare] = res.body.created as { id: string; name: string; token: string; claimCode: string | null }[];
    expect(pump).toMatchObject({ name: 'Pump 1', claimCode: null, token: expect.stringMatching(/^pdt_/) });
    expect(spare!.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const rows = await t.db.select().from(device).where(inArray(device.id, [pump!.id, spare!.id]));
    const p = rows.find((r) => r.id === pump!.id)!;
    expect(p).toMatchObject({ customerId: c.id, groupId: group.id, tags: ['north', 'pump'] });
    expect(p.location).toMatchObject({ lat: 51.5, lng: -0.12, source: 'fixed' });
    expect(rows.find((r) => r.id === spare!.id)!.customerId).toBeNull();
    expect(await t.db.query.deviceClaim.findFirst({ where: eq(deviceClaim.deviceId, spare!.id) })).toBeTruthy();

    // The tokens work.
    expect(await t.app.get(CredentialsService).verifyToken(pump!.id, pump!.token)).toBe(true);
    expect(await t.app.get(CredentialsService).verifyToken(spare!.id, spare!.token)).toBe(true);
  });

  it('claim codes only for unassigned devices; locations only where the profile has them', async () => {
    const plain = await createProfile(t.db, { name: `Plain ${unique()}`, locationMode: 'none' });
    const c = await createCustomer(t.db);
    const res = await upload(`name,profile,customer,lat,lng,claim\nA,${plain.name},${c.slug},,,yes\nB,${plain.name},,1,2,`, true);
    expect(res.body.errors.map((e: { row: number; field: string }) => [e.row, e.field])).toEqual([
      [1, 'claim'],
      [2, 'lat'],
    ]);
  });

  it('checks the header and the size', async () => {
    expect((await upload('name,colour\nA,red', true)).body.errors[0]).toMatchObject({ row: 0, field: 'colour' });
    expect((await upload('name\nA', true)).body.errors[0]).toMatchObject({ row: 0, field: 'profile' });
    const many = ['name,profile', ...Array.from({ length: 5001 }, (_, i) => `D${i},P`)].join('\n');
    expect((await upload(many, true)).status).toBe(400);
  });

  it('is for the platform', async () => {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    expect((await upload('name,profile\nA,B', true, auth)).status).toBe(403);
  });
});

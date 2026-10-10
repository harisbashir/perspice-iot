import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJob, trip } from '../../src/db/schema';
import { ExportCleanupJob } from '../../src/exports/export-cleanup.job';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const binary = (res: { on: (e: string, cb: (c?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c?: Buffer) => c && chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('exports', () => {
  let t: TestApp;
  let auth: string;
  let otherAuth: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const o = await createUser(t.db, { roleKey: 'platform_admin' });
    otherAuth = `Bearer ${await tokenFor(t, o.email, o.password)}`;
    await t.http
      .put('/api/branding/platform')
      .set('Authorization', auth)
      .send({ productName: 'Acme Monitor' });
  });

  afterAll(async () => {
    await t?.close();
  });

  const T0 = Date.UTC(2026, 0, 1);

  async function deviceWithHistory(rows = 3) {
    const profile = await createProfile(t.db, { telemetrySchema: [{ key: 'fuel_level', label: 'Fuel', unit: '%', type: 'number' }] });
    const { device } = await createDevice(t.db, { profileId: profile.id, name: 'Tower 17' });
    await t.db.execute(sql`
      INSERT INTO telemetry (device_id, key, ts, value_num)
      SELECT ${device.id}::uuid, k, to_timestamp((${T0}::bigint + g::bigint * 60000) / 1000.0), g + CASE WHEN k = 'batt_v' THEN 50 ELSE 0 END
      FROM generate_series(0, ${rows - 1}) g, unnest(ARRAY['fuel_level', 'batt_v']) k`);
    return device;
  }

  const exportTelemetry = (deviceId: string, format: string, a = auth) =>
    t.http
      .post('/api/exports')
      .set('Authorization', a)
      .send({ kind: 'telemetry', format, params: { deviceId, keys: ['fuel_level', 'batt_v'], from: T0, to: T0 + 60 * 86_400_000 } })
      .buffer(true)
      .parse(binary);

  it('exports telemetry history as CSV with one column per key', async () => {
    const d = await deviceWithHistory();
    const res = await exportTelemetry(d.id, 'csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.csv"/);
    const lines = (res.body as Buffer).toString('utf8').trim().split('\n');
    expect(lines[0]).toBe('Time (UTC),Fuel (%),batt_v');
    expect(lines[1]).toBe('2026-01-01 00:00:00,0,50');
    expect(lines).toHaveLength(4);
  });

  it('exports a device’s trips as CSV', async () => {
    const profile = await createProfile(t.db, { locationMode: 'reported' });
    const { device } = await createDevice(t.db, { profileId: profile.id, name: 'Van 3' });
    await t.db.insert(trip).values([
      { deviceId: device.id, startTs: new Date(T0), endTs: new Date(T0 + 30 * 60_000), startLat: 51.5, startLng: -0.12, endLat: 51.6, endLng: -0.1, distanceM: 12_345, maxSpeedKmh: 72.4, avgSpeedKmh: 24.7 },
      { deviceId: device.id, startTs: new Date(T0 - 10 * 86_400_000), endTs: new Date(T0 - 10 * 86_400_000 + 60_000), startLat: 1, startLng: 1, endLat: 1, endLng: 1, distanceM: 1 },
    ]);
    const res = await t.http
      .post('/api/exports')
      .set('Authorization', auth)
      .send({ kind: 'trips', format: 'csv', params: { deviceId: device.id, from: T0 - 86_400_000, to: T0 + 86_400_000 } })
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const lines = (res.body as Buffer).toString('utf8').trim().split('\n');
    expect(lines[0]).toBe('Start (UTC),End (UTC),Duration (min),Distance (km),Max speed (km/h),Average speed (km/h),Start latitude,Start longitude,End latitude,End longitude');
    expect(lines.slice(1)).toEqual(['2026-01-01 00:00:00,2026-01-01 00:30:00,30,12.35,72.4,24.7,51.5,-0.12,51.6,-0.1']);
  });

  it('exports XLSX that parses back', async () => {
    const d = await deviceWithHistory();
    const res = await exportTelemetry(d.id, 'xlsx');
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Time (UTC)', 'Fuel (%)', 'batt_v']);
    expect(ws.getRow(3).getCell(2).value).toBe(1);
    expect(ws.getRow(2).getCell(1).value).toBeInstanceOf(Date);
  });

  it('exports a branded PDF', async () => {
    const d = await deviceWithHistory();
    const res = await exportTelemetry(d.id, 'pdf');
    expect(res.status).toBe(200);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.includes('Acme Monitor')).toBe(true);
  });

  it('exports the device list and the audit log', async () => {
    await deviceWithHistory(1);
    const devices = await t.http
      .post('/api/exports')
      .set('Authorization', auth)
      .send({ kind: 'devices', format: 'csv', params: { columns: ['name', 'status'] } })
      .buffer(true)
      .parse(binary);
    expect((devices.body as Buffer).toString()).toMatch(/^Name,Status\n.*Tower 17,never/s);
    const audit = await t.http.post('/api/exports').set('Authorization', auth).send({ kind: 'audit', format: 'csv', params: {} }).buffer(true).parse(binary);
    expect((audit.body as Buffer).toString()).toMatch(/^Time \(UTC\),Action,Actor type/);
  });

  it("customers cannot export another tenant's device; viewers cannot export at all", async () => {
    const d = await deviceWithHistory(1);
    const c = await createCustomer(t.db);
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    const host = `${c.slug}.localhost`;
    expect((await exportTelemetry(d.id, 'csv', `Bearer ${await tokenFor(t, admin.email, admin.password, host)}`)).status).toBe(404);
    expect((await exportTelemetry(d.id, 'csv', `Bearer ${await tokenFor(t, viewer.email, viewer.password, host)}`)).status).toBe(403);
  });

  it('runs large exports in the background, for the owner only, and expires them (Review Focus 4)', async () => {
    const d = await deviceWithHistory(50_001); // above the 50,000-row synchronous limit
    const res = await t.http
      .post('/api/exports')
      .set('Authorization', auth)
      .send({ kind: 'telemetry', format: 'csv', params: { deviceId: d.id, keys: ['fuel_level', 'batt_v'], from: T0, to: T0 + 60 * 86_400_000 } });
    expect(res.status).toBe(202);
    const jobId = res.body.id as string;

    let job: { status: string; rowCount: number; downloadUrl: string | null } | undefined;
    for (let i = 0; i < 120 && job?.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      job = (await t.http.get(`/api/exports/${jobId}`).set('Authorization', auth)).body;
    }
    expect(job).toMatchObject({ status: 'done', rowCount: 50_001 });
    const file = await t.http.get(job!.downloadUrl!).buffer(true).parse(binary);
    expect(file.status).toBe(200);
    expect((file.body as Buffer).toString().trim().split('\n')).toHaveLength(50_002);

    expect((await t.http.get(`/api/exports/${jobId}`).set('Authorization', otherAuth)).status).toBe(404);
    const notifications = await t.http.get('/api/notifications').set('Authorization', auth);
    expect(notifications.body.items.some((n: { type: string; link: string }) => n.type === 'export.ready' && n.link === `/exports/${jobId}`)).toBe(true);

    // Once expired (24 h after completion) the link is gone and the cleanup job removes the file.
    await t.db.update(exportJob).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(exportJob.id, jobId));
    const expired = await t.http.get(`/api/exports/${jobId}`).set('Authorization', auth);
    expect(expired.body.downloadUrl).toBeNull();
    await t.app.get(ExportCleanupJob).run(new Date());
    expect(await t.db.query.exportJob.findFirst({ where: eq(exportJob.id, jobId) })).toBeUndefined();
    expect((await t.http.get(job!.downloadUrl!)).status).toBe(404);
  });

  it('refuses very large PDF exports', async () => {
    const d = await deviceWithHistory(10_001);
    const res = await exportTelemetry(d.id, 'pdf');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

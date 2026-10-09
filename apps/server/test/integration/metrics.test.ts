import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Heartbeat } from '../../src/system/heartbeat';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('metrics and heartbeats', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const value = (text: string, series: string) => {
    const line = text.split('\n').find((l) => l.startsWith(series));
    return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : null;
  };

  it('exposes Prometheus metrics that count ingested messages', async () => {
    const profile = await createProfile(t.db);
    const { token } = await createDevice(t.db, { profileId: profile.id });
    const before = await t.http.get('/metrics');
    expect(before.status).toBe(200);
    expect(before.headers['content-type']).toContain('text/plain');
    const accepted = (text: string) => value(text, 'perspice_ingest_messages_total{result="accepted",role="all"}') ?? 0;

    await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: { t: 1 } }).expect(202);
    await t.http.post('/api/v1/device/telemetry').set('x-device-token', token).send({ values: { t: 2 } }).expect(202);
    const after = await t.http.get('/metrics');
    expect(accepted(after.text) - accepted(before.text)).toBe(2);
    for (const series of ['perspice_devices{', 'perspice_queue_jobs{queue="notify"', 'perspice_websocket_clients', 'perspice_process_resident_memory_bytes', 'perspice_alarms_open']) {
      if (series === 'perspice_alarms_open') expect(after.text).toContain('# HELP perspice_alarms_open');
      else expect(after.text).toContain(series);
    }
  });

  it('is not served under the public /api prefix', async () => {
    expect((await t.http.get('/api/metrics')).status).toBe(404);
  });

  it('announces the process in Redis with a short expiry', async () => {
    const hb = t.app.get(Heartbeat);
    await hb.beat();
    const info = JSON.parse((await t.redis.get(hb.key))!);
    expect(info).toMatchObject({ role: 'all', version: expect.any(String) });
    const ttl = await t.redis.ttl(hb.key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });
});

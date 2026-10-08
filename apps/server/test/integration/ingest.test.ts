import { and, eq, sql } from 'drizzle-orm';
import type { MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { device, telemetry, telemetryLatest } from '../../src/db/schema';
import { DebugLogService } from '../../src/devices/debug-log.service';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < deadline);
  return last;
}

describe('ingest', () => {
  let t: TestApp;
  const clients: MqttClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    await t?.close();
  });

  async function newDevice() {
    const p = await createProfile(t.db);
    const { device: d, token } = await createDevice(t.db, { profileId: p.id });
    const client = await connectDevice(t, d.id, token);
    clients.push(client);
    return { id: d.id, client, topic: (ch: string) => `perspice/v1/${d.id}/${ch}` };
  }

  const countRows = async (deviceId: string) =>
    (
      await t.db
        .select({ n: sql<number>`count(*)::int` })
        .from(telemetry)
        .where(eq(telemetry.deviceId, deviceId))
    )[0]!.n;

  it('stores telemetry, latest values and the Redis latest cache within 2 s', async () => {
    const d = await newDevice();
    const base = Date.now() - 3000;
    for (let i = 0; i < 3; i++) {
      await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ ts: base + i * 1000, values: { temp: 20 + i } }), {
        qos: 1,
      });
    }
    expect(await eventually(() => countRows(d.id), (n) => n === 3)).toBe(3);
    const latest = await eventually(
      () => t.db.query.telemetryLatest.findFirst({ where: and(eq(telemetryLatest.deviceId, d.id), eq(telemetryLatest.key, 'temp')) }),
      (r) => r?.valueNum === 22,
    );
    expect(latest?.ts.getTime()).toBe(base + 2000);
    const cached = JSON.parse((await t.redis.hget(`latest:${d.id}`, 'temp'))!);
    expect(cached).toEqual({ ts: base + 2000, v: 22 });
  });

  it('drops duplicate (device, key, ts) rows', async () => {
    const d = await newDevice();
    const msg = JSON.stringify({ ts: Date.now() - 1000, values: { temp: 1 } });
    await d.client.publishAsync(d.topic('telemetry'), msg, { qos: 1 });
    await d.client.publishAsync(d.topic('telemetry'), msg, { qos: 1 });
    await eventually(() => countRows(d.id), (n) => n >= 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await countRows(d.id)).toBe(1);
  });

  it('an older message does not overwrite the latest value', async () => {
    const d = await newDevice();
    const now = Date.now();
    await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ ts: now, values: { temp: 5 } }), { qos: 1 });
    await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ ts: now - 60_000, values: { temp: 1 } }), { qos: 1 });
    await eventually(() => countRows(d.id), (n) => n === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.parse((await t.redis.hget(`latest:${d.id}`, 'temp'))!).v).toBe(5);
    const row = await t.db.query.telemetryLatest.findFirst({ where: eq(telemetryLatest.deviceId, d.id) });
    expect(row?.valueNum).toBe(5);
  });

  it('logs rejected payloads to the debug view and keeps processing (Review Focus 3)', async () => {
    const d = await newDevice();
    await d.client.publishAsync(d.topic('telemetry'), '{"values":{"a/b":1}}', { qos: 1 });
    await d.client.publishAsync(d.topic('telemetry'), 'not json', { qos: 1 });
    await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ values: { ok: 1 } }), { qos: 1 });
    expect(await eventually(() => countRows(d.id), (n) => n === 1)).toBe(1);
    const log = await t.app.get(DebugLogService).list(d.id);
    expect(log.filter((e) => e.kind === 'rejected').map((e) => e.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid_key'), expect.stringContaining('invalid_json')]),
    );
  });

  it('flags adjusted timestamps in the debug log (Review Focus 1)', async () => {
    const d = await newDevice();
    await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ ts: 0, values: { t: 1 } }), { qos: 1 });
    expect(await eventually(() => countRows(d.id), (n) => n === 1)).toBe(1);
    const log = await t.app.get(DebugLogService).list(d.id);
    expect(log.some((e) => e.kind === 'ts_adjusted')).toBe(true);
  });

  it('merges client attributes and records the firmware version', async () => {
    const d = await newDevice();
    await d.client.publishAsync(d.topic('attributes'), JSON.stringify({ fw: '1.2.3', serial: 'SN-1' }), { qos: 1 });
    const row = await eventually(
      () => t.db.query.device.findFirst({ where: eq(device.id, d.id) }),
      (r) => r?.firmwareVersion === '1.2.3',
    );
    expect(row?.attributes.client).toMatchObject({ fw: '1.2.3', serial: 'SN-1' });
  });

  it('publishes live values for websocket fan-out', async () => {
    const d = await newDevice();
    const sub = t.redis.duplicate();
    const got = new Promise<string>((resolve) => sub.on('message', (_ch, msg) => resolve(msg)));
    await sub.subscribe(`ws:telemetry:${d.id}`);
    await d.client.publishAsync(d.topic('telemetry'), JSON.stringify({ values: { temp: 7 } }), { qos: 1 });
    const msg = JSON.parse(await got) as { deviceId: string; values: Record<string, { v: unknown }> };
    expect(msg.deviceId).toBe(d.id);
    expect(msg.values.temp?.v).toBe(7);
    await sub.quit();
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device } from '../../src/db/schema';
import { MessageRouter } from '../../src/ingest/message-router';
import { OfflineSweepJob } from '../../src/presence/offline-sweep.job';
import { PresenceService } from '../../src/presence/presence.service';
import { JobRegistry } from '../../src/scheduler/job-registry';
import { createDevice, createProfile } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';

async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < deadline);
  return last;
}

describe('presence', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  const statusOf = async (id: string) =>
    (await t.db.query.device.findFirst({ where: eq(device.id, id), columns: { status: true } }))!.status;

  async function statusEvents(deviceId: string) {
    const entries = (await t.redis.xrange('events:device', '-', '+')) as [string, string[]][];
    return entries
      .map(([, f]) => JSON.parse(f[1]!) as { type: string; deviceId: string; from: string; to: string })
      .filter((e) => e.type === 'device.status_changed' && e.deviceId === deviceId);
  }

  async function setup(profile: { offlineTimeoutS?: number; deadTimeoutS?: number; sleepy?: boolean } = {}) {
    const p = await createProfile(t.db, { offlineTimeoutS: 10, deadTimeoutS: 60, ...profile });
    return createDevice(t.db, { profileId: p.id });
  }

  const publish = (id: string, values: Record<string, unknown> = { t: 1 }) =>
    t.app.get(MessageRouter).handle(`perspice/v1/${id}/telemetry`, Buffer.from(JSON.stringify({ values })));

  it('telemetry brings a device online; the sweep marks it offline then dead', async () => {
    const { device: d } = await setup();
    await publish(d.id);
    expect(await statusOf(d.id)).toBe('online');

    const sweep = t.app.get(OfflineSweepJob);
    await sweep.sweep(Date.now() + 5_000);
    expect(await statusOf(d.id)).toBe('online');
    await sweep.sweep(Date.now() + 11_000);
    expect(await statusOf(d.id)).toBe('offline');
    await sweep.sweep(Date.now() + 61_000);
    expect(await statusOf(d.id)).toBe('dead');

    const events = await statusEvents(d.id);
    expect(events.map((e) => `${e.from}->${e.to}`)).toEqual(['never->online', 'online->offline', 'offline->dead']);

    await publish(d.id);
    expect(await statusOf(d.id)).toBe('online');
  });

  it('per-device timeouts override the profile', async () => {
    const { device: d } = await setup();
    await t.db.update(device).set({ offlineTimeoutS: 120, deadTimeoutS: 600 }).where(eq(device.id, d.id));
    await publish(d.id);
    await t.app.get(OfflineSweepJob).sweep(Date.now() + 11_000);
    expect(await statusOf(d.id)).toBe('online');
    await t.app.get(OfflineSweepJob).sweep(Date.now() + 121_000);
    expect(await statusOf(d.id)).toBe('offline');
  });

  it('MQTT connect/disconnect events set status immediately', async () => {
    const created = await setup();
    const c = await connectDevice(t, created.device.id, created.token);
    expect(await eventually(() => statusOf(created.device.id), (s) => s === 'online')).toBe('online');
    await c.endAsync();
    expect(await eventually(() => statusOf(created.device.id), (s) => s === 'offline')).toBe('offline');
  });

  it('sleepy devices stay online after an MQTT disconnect until the timeout', async () => {
    const created = await setup({ sleepy: true });
    const c = await connectDevice(t, created.device.id, created.token);
    expect(await eventually(() => statusOf(created.device.id), (s) => s === 'online')).toBe('online');
    await c.endAsync();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await statusOf(created.device.id)).toBe('online');
    await t.app.get(OfflineSweepJob).sweep(Date.now() + 11_000);
    expect(await statusOf(created.device.id)).toBe('offline');
  });

  it('ignores a stale disconnect that arrives after a reconnect (Review Focus 2)', async () => {
    const { device: d } = await setup();
    const presence = t.app.get(PresenceService);
    const t1 = Date.now() - 2000;
    const t2 = Date.now() - 1000;
    await presence.onConnected(d.id, t2);
    await presence.onDisconnected(d.id, t1, 'takeover');
    expect(await statusOf(d.id)).toBe('online');
    // A disconnect of the current session does count.
    await presence.onDisconnected(d.id, t2, 'normal');
    expect(await statusOf(d.id)).toBe('offline');
  });

  it('writes last_seen back to Postgres', async () => {
    const { device: d } = await setup();
    await publish(d.id);
    await t.app.get(PresenceService).flushLastSeen();
    const row = await t.db.query.device.findFirst({ where: eq(device.id, d.id) });
    expect(row?.lastSeen?.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('refreshes the stored last_seen only once it is 5 minutes behind', async () => {
    const { device: d } = await setup();
    const presence = t.app.get(PresenceService);
    const base = Date.now() - 3_600_000;
    const stored = async () => (await t.db.query.device.findFirst({ where: eq(device.id, d.id) }))!.lastSeen!.getTime();
    await presence.touch(d.id, base);
    await presence.flushLastSeen();
    expect(await stored()).toBe(base);
    await presence.touch(d.id, base + 60_000);
    await presence.flushLastSeen();
    expect(await stored()).toBe(base); // a minute newer: not worth a row update
    await presence.touch(d.id, base + 6 * 60_000);
    await presence.flushLastSeen();
    expect(await stored()).toBe(base + 6 * 60_000);
  });

  it('two scheduler instances run a job once per interval', async () => {
    const second = await createTestApp({ databaseUrl: t.config.DATABASE_URL, role: 'scheduler' });
    try {
      let runs = 0;
      const job = async () => {
        runs++;
      };
      t.app.get(JobRegistry).every('test-once', 400, job);
      second.app.get(JobRegistry).every('test-once', 400, job);
      await new Promise((r) => setTimeout(r, 2100));
      expect(runs).toBeGreaterThanOrEqual(4);
      expect(runs).toBeLessThanOrEqual(6);
    } finally {
      await second.close();
    }
  });
});

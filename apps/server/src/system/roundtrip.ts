import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import mqtt from 'mqtt';
import { randomToken, sha256Hex } from '../common/crypto';
import type { DB } from '../db/db.module';
import { device, deviceProfile } from '../db/schema';

export interface RoundtripResult {
  ok: boolean;
  /** Publish → stored, in milliseconds. */
  ms: number | null;
  message: string;
}

/**
 * Creates a temporary device, publishes one value over MQTT and waits for it in the latest-value
 * cache (i.e. broker auth → ingest → Redis all work), then removes the device again.
 */
export async function mqttRoundtrip(db: DB, redis: Redis, mqttUrl: string): Promise<RoundtripResult> {
  const [profile] = await db
    .insert(deviceProfile)
    .values({ name: `health-check-${Date.now()}` })
    .returning();
  const token = randomToken('pdt_');
  const [dev] = await db
    .insert(device)
    .values({ name: 'health-check', profileId: profile!.id, credentialsHash: sha256Hex(token) })
    .returning();
  const client = mqtt.connect(mqttUrl, { clientId: dev!.id, username: dev!.id, password: token, reconnectPeriod: 0, connectTimeout: 10_000 });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });
    const value = Math.round(Math.random() * 1e6);
    const started = Date.now();
    await client.publishAsync(`perspice/v1/${dev!.id}/telemetry`, JSON.stringify({ values: { health: value } }), { qos: 1 });
    for (let i = 0; i < 40; i++) {
      const cached = await redis.hget(`latest:${dev!.id}`, 'health');
      if (cached && (JSON.parse(cached) as { v: number }).v === value) return { ok: true, ms: Date.now() - started, message: 'ok' };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, ms: null, message: 'the value was not stored within 10 s (is ingest running?)' };
  } catch (e) {
    return { ok: false, ms: null, message: `the broker refused or is unreachable (${(e as Error).message})` };
  } finally {
    client.end(true);
    await db.delete(device).where(eq(device.id, dev!.id));
    await db.delete(deviceProfile).where(eq(deviceProfile.id, profile!.id));
    await redis.del(`latest:${dev!.id}`, `devmeta:${dev!.id}`, `devtok:${dev!.id}`);
  }
}

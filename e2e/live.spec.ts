import { expect, test } from '@playwright/test';
import mqtt from 'mqtt';

// Smoke test against a running installation. Needs PERSPICE_LIVE_URL and an API key with
// device.read, device.write, profile.read and telemetry.read in PERSPICE_LIVE_ADMIN_TOKEN.
const URL = (process.env.PERSPICE_LIVE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.PERSPICE_LIVE_ADMIN_TOKEN ?? '';
const MQTT = process.env.PERSPICE_LIVE_MQTT_URL ?? (URL ? `mqtt://mqtt.${new globalThis.URL(URL).hostname}:1883` : '');

test.skip(!URL || !KEY, 'Set PERSPICE_LIVE_URL and PERSPICE_LIVE_ADMIN_TOKEN');

const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${URL}/api${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' } });
  expect(res.ok, `${init.method ?? 'GET'} ${path} → ${res.status}`).toBe(true);
  return (res.status === 204 ? undefined : await res.json()) as T;
};

test('health, temporary device, MQTT round trip, cleanup', async () => {
  const health = await fetch(`${URL}/health`);
  expect(health.ok).toBe(true);

  const profiles = await api<{ id: string }[]>('/device-profiles');
  const { device, token } = await api<{ device: { id: string }; token: string }>('/devices', {
    method: 'POST',
    body: JSON.stringify({ name: `live-test-${Date.now()}`, profileId: profiles[0]!.id }),
  });
  try {
    const client = await mqtt.connectAsync(MQTT, { clientId: device.id, username: device.id, password: token, reconnectPeriod: 0 });
    const value = Math.round(Math.random() * 1e6);
    await client.publishAsync(`perspice/v1/${device.id}/telemetry`, JSON.stringify({ values: { live_check: value } }), { qos: 1 });
    await client.endAsync();
    await expect
      .poll(async () => (await api<Record<string, { v: number }>>(`/devices/${device.id}/telemetry/latest`)).live_check?.v, { timeout: 15_000 })
      .toBe(value);
  } finally {
    await api(`/devices/${device.id}`, { method: 'DELETE' });
  }
});

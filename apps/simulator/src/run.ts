import { readFile, writeFile } from 'node:fs/promises';
import { type Socket, io } from 'socket.io-client';
import { ApiClient } from './api.js';
import { SimDevice } from './device.js';

export interface SimOptions {
  url: string;
  apiKey: string;
  mqtt: string;
  profile: string;
  count: number;
  intervalS: number;
  durationS: number;
  create: boolean;
  sleepy: boolean;
  http: boolean;
  measureLatency: boolean;
  devicesFile: string;
  log?: (line: string) => void;
}

export interface SimReport {
  devices: number;
  sent: number;
  errors: number;
  durationS: number;
  messagesPerSecond: number;
  latencyMs: { samples: number; p50: number | null; p95: number | null };
}

interface StoredDevice {
  id: string;
  token: string;
  name: string;
}

export const percentile = (sorted: number[], p: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : null;

async function loadOrCreate(api: ApiClient, o: SimOptions, profileId: string): Promise<StoredDevice[]> {
  let stored: StoredDevice[] = [];
  try {
    stored = JSON.parse(await readFile(o.devicesFile, 'utf8')) as StoredDevice[];
  } catch {
    /* no file yet */
  }
  if (o.create) {
    for (let n = stored.length + 1; stored.length < o.count; n++) {
      const { device, token } = await api.createDevice(`sim-${n}`, profileId);
      stored.push({ id: device.id, token, name: device.name });
    }
    await writeFile(o.devicesFile, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  if (stored.length < o.count) throw new Error(`Only ${stored.length} devices in ${o.devicesFile}; use --create`);
  return stored.slice(0, o.count);
}

/** Subscribes to ~1% of the devices over the realtime API and records publish → push latency. */
async function latencyProbe(o: SimOptions, devices: StoredDevice[], samples: number[]): Promise<Socket> {
  const socket = io(`${o.url.replace(/\/$/, '')}/rt`, { path: '/api/socket.io', auth: { token: o.apiKey }, transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  const watched = devices.slice(0, Math.max(1, Math.round(devices.length / 100)));
  for (const d of watched) await socket.emitWithAck('subscribe:device', { deviceId: d.id });
  socket.on('telemetry', (e: { values: Record<string, { ts: number }> }) => {
    const ts = Math.max(...Object.values(e.values).map((v) => v.ts));
    samples.push(Date.now() - ts);
  });
  return socket;
}

export async function runSimulation(o: SimOptions): Promise<SimReport> {
  const log = o.log ?? ((l: string) => console.log(l));
  const api = new ApiClient(o.url, o.apiKey);
  const profile = await api.profile(o.profile);
  const stored = await loadOrCreate(api, o, profile.id);

  let sent = 0;
  let errors = 0;
  const devices = stored.map(
    (d) =>
      new SimDevice({
        id: d.id,
        token: d.token,
        mqttUrl: o.mqtt,
        apiUrl: o.url,
        keys: profile.telemetrySchema,
        http: o.http,
        sleepy: o.sleepy,
        onSent: () => sent++,
        onError: (err) => {
          errors++;
          if (errors <= 5) log(`device error: ${err.message}`);
        },
      }),
  );
  await Promise.all(devices.map((d) => d.start()));

  const samples: number[] = [];
  const socket = o.measureLatency ? await latencyProbe(o, stored, samples) : undefined;

  const started = Date.now();
  const end = started + o.durationS * 1000;
  // Spread devices evenly across the interval rather than publishing in bursts.
  const timers = devices.map((d, i) =>
    setTimeout(() => {
      void d.tick();
      const t = setInterval(() => (Date.now() < end ? void d.tick() : clearInterval(t)), o.intervalS * 1000);
      timers.push(t);
    }, (i * o.intervalS * 1000) / devices.length),
  );
  const progress = setInterval(() => {
    const secs = (Date.now() - started) / 1000;
    log(`${secs.toFixed(0)}s: ${sent} sent (${(sent / secs).toFixed(1)} msg/s), ${errors} errors`);
  }, 5000);

  await new Promise((r) => setTimeout(r, o.durationS * 1000));
  clearInterval(progress);
  for (const t of timers) clearTimeout(t);
  await new Promise((r) => setTimeout(r, 1000)); // let in-flight messages arrive
  socket?.close();
  await Promise.all(devices.map((d) => d.stop()));

  const sorted = [...samples].sort((a, b) => a - b);
  const durationS = (Date.now() - started) / 1000;
  return {
    devices: devices.length,
    sent,
    errors,
    durationS: Math.round(durationS),
    messagesPerSecond: Math.round((sent / durationS) * 10) / 10,
    latencyMs: { samples: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
  };
}

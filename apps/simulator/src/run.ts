import { readFile, writeFile } from 'node:fs/promises';
import { type Socket, io } from 'socket.io-client';
import { ApiClient } from './api.js';
import { SimDevice } from './device.js';
import { type MobileOptions, mobileRoute } from './mobility.js';

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
  /** Accept self-signed certificates (local test stacks only). */
  insecure?: boolean;
  /** New MQTT connections per second at start-up, so 10,000 devices don't stampede the broker. */
  connectRate?: number;
  /** Parallel requests when creating devices. */
  createConcurrency?: number;
  /** This fraction of the devices (0–1) drive around `mobileArea`, reporting lat/lng/speed. */
  mobileShare?: number;
  mobileArea?: MobileOptions;
  log?: (line: string) => void;
}

export interface MinuteReport {
  minute: number;
  sent: number;
  messagesPerSecond: number;
  errors: number;
  latencyP95Ms: number | null;
}

export interface SimReport {
  devices: number;
  sent: number;
  errors: number;
  durationS: number;
  messagesPerSecond: number;
  latencyMs: { samples: number; p50: number | null; p95: number | null; p99: number | null; max: number | null };
  /** The sending window (epoch ms): every message's `ts` falls inside it. */
  startedAt: number;
  endedAt: number;
  connectS: number;
  perMinute: MinuteReport[];
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
  if (o.create && stored.length < o.count) {
    const log = o.log ?? ((l: string) => console.log(l));
    const save = () => writeFile(o.devicesFile, JSON.stringify(stored, null, 2), { mode: 0o600 });
    let next = stored.length + 1;
    const missing = o.count - stored.length;
    const worker = async () => {
      while (stored.length < o.count && next <= o.count) {
        const n = next++;
        const { device, token } = await api.createDevice(`sim-${n}`, profileId);
        stored.push({ id: device.id, token, name: device.name });
        if (stored.length % 1000 === 0) {
          log(`created ${stored.length}/${o.count} devices`);
          await save();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.createConcurrency ?? 16, missing) }, worker));
    await save();
  }
  if (stored.length < o.count) throw new Error(`Only ${stored.length} devices in ${o.devicesFile}; use --create`);
  return stored.slice(0, o.count);
}

/** Subscribes to ~1% of the devices over the realtime API and records publish → push latency. */
async function latencyProbe(o: SimOptions, devices: StoredDevice[], samples: number[]): Promise<Socket> {
  const socket = io(`${o.url.replace(/\/$/, '')}/rt`, {
    path: '/api/socket.io',
    auth: { token: o.apiKey },
    transports: ['websocket'],
    rejectUnauthorized: !o.insecure,
  });
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
  const mobileCount = Math.round(stored.length * (o.mobileShare ?? 0));
  const area = o.mobileArea ?? { center: { lat: 51.5, lng: -0.12 }, radiusKm: 20 };
  const devices = stored.map(
    (d, i) =>
      new SimDevice({
        ...(i < mobileCount ? { mobile: mobileRoute(area, o.intervalS) } : {}),
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
  const connectStarted = Date.now();
  const rate = o.connectRate ?? 500;
  for (let i = 0; i < devices.length; i += rate) {
    const batchStart = Date.now();
    await Promise.all(devices.slice(i, i + rate).map((d) => d.start()));
    if (devices.length > rate) log(`connected ${Math.min(i + rate, devices.length)}/${devices.length}`);
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - batchStart))));
  }
  const connectS = Math.round((Date.now() - connectStarted) / 1000);

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
  const perMinute: MinuteReport[] = [];
  let mark = { sent: 0, errors: 0, samples: 0 };
  const minuteReport = () => {
    const window = [...samples.slice(mark.samples)].sort((a, b) => a - b);
    const secs = Math.min(60, (Date.now() - started) / 1000 - perMinute.length * 60);
    const m: MinuteReport = {
      minute: perMinute.length + 1,
      sent: sent - mark.sent,
      messagesPerSecond: Math.round(((sent - mark.sent) / Math.max(1, secs)) * 10) / 10,
      errors: errors - mark.errors,
      latencyP95Ms: percentile(window, 95),
    };
    perMinute.push(m);
    mark = { sent, errors, samples: samples.length };
    log(`minute ${m.minute}: ${m.sent} sent (${m.messagesPerSecond} msg/s), ${m.errors} errors, p95 ${m.latencyP95Ms ?? '-'} ms`);
  };
  const minutes = setInterval(minuteReport, 60_000);

  await new Promise((r) => setTimeout(r, o.durationS * 1000));
  clearInterval(minutes);
  const endedAt = Date.now();
  for (const t of timers) clearTimeout(t);
  await new Promise((r) => setTimeout(r, 1000)); // let in-flight messages arrive
  socket?.close();
  await Promise.all(devices.map((d) => d.stop()));

  if (perMinute.length * 60 < o.durationS) minuteReport();

  const sorted = [...samples].sort((a, b) => a - b);
  const durationS = (endedAt - started) / 1000;
  return {
    devices: devices.length,
    sent,
    errors,
    durationS: Math.round(durationS),
    messagesPerSecond: Math.round((sent / durationS) * 10) / 10,
    latencyMs: { samples: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1) ?? null },
    startedAt: started,
    endedAt,
    connectS,
    perMinute,
  };
}

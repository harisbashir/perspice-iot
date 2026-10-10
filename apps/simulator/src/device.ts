import type { OtaMessage, OtaProgress, TelemetryKeyDef } from '@perspice/shared';
import { createHash } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import type { MobileFix } from './mobility.js';
import { valueGenerator } from './values.js';

export interface SimDeviceOptions {
  id: string;
  token: string;
  mqttUrl: string;
  apiUrl: string;
  keys: TelemetryKeyDef[];
  http: boolean;
  sleepy: boolean;
  onSent: () => void;
  onError: (err: Error) => void;
  /** Mobile devices: the next position, sent with every message. */
  mobile?: () => MobileFix;
  /** Reported as the fw attribute on every connect (MQTT). */
  firmwareVersion?: string;
  /** Take OTA updates: download, check the SHA-256, report progress, "reboot" on the new version. */
  ota?: boolean;
  onOta?: (event: string) => void;
}

/** One simulated device: publishes values, acks every command with `{ echo: params }`, optionally updates its firmware. */
export class SimDevice {
  private client?: MqttClient;
  private readonly next: () => Record<string, unknown>;
  private version: string | undefined;
  private updating: string | null = null;

  constructor(private readonly o: SimDeviceOptions) {
    this.next = valueGenerator(o.keys);
    this.version = o.firmwareVersion;
  }

  get firmwareVersion(): string | undefined {
    return this.version;
  }

  async start(): Promise<void> {
    if (this.o.http || this.o.sleepy) return;
    this.client = await this.connect();
  }

  async tick(): Promise<void> {
    const payload = JSON.stringify({ ts: Date.now(), values: { ...this.next(), ...(this.o.mobile ? this.o.mobile() : {}) } });
    try {
      if (this.o.http) await this.postHttp(payload);
      else if (this.o.sleepy) {
        const c = await this.connect();
        await c.publishAsync(this.topic('telemetry'), payload, { qos: 1 });
        await c.endAsync();
      } else {
        await this.client!.publishAsync(this.topic('telemetry'), payload, { qos: 1 });
      }
      this.o.onSent();
    } catch (err) {
      this.o.onError(err as Error);
    }
  }

  async stop(): Promise<void> {
    await this.client?.endAsync(true);
  }

  private topic(channel: string): string {
    return `perspice/v1/${this.o.id}/${channel}`;
  }

  private connect(): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(this.o.mqttUrl, {
        clientId: this.o.id,
        username: this.o.id,
        password: this.o.token,
        // MQTT 5 reports a refused publish in the PUBACK, so it counts as an error, not as sent.
        protocolVersion: 5,
        reconnectPeriod: this.o.sleepy ? 0 : 2000,
        connectTimeout: 10_000,
      });
      c.once('connect', () => {
        c.subscribe(this.topic('cmd'), { qos: 1 });
        if (this.o.ota) c.subscribe(this.topic('ota'), { qos: 1 });
        if (this.version) void c.publishAsync(this.topic('attributes'), JSON.stringify({ fw: this.version }), { qos: 1 });
        resolve(c);
      });
      c.once('error', reject);
      c.on('message', (topic, buf) => {
        if (topic.endsWith('/ota')) {
          void this.update(buf).catch((err: Error) => this.o.onError(err));
          return;
        }
        if (!topic.endsWith('/cmd')) return;
        try {
          const cmd = JSON.parse(buf.toString()) as { cid: string; params?: unknown };
          void c.publishAsync(this.topic('cmd/ack'), JSON.stringify({ cid: cmd.cid, status: 'success', result: { echo: cmd.params ?? {} } }), { qos: 1 });
        } catch {
          /* ignore malformed commands */
        }
      });
    });
  }

  private async progress(p: OtaProgress): Promise<void> {
    this.o.onOta?.(`${p.state}${p.pct !== undefined ? ` ${p.pct}%` : ''}${p.error ? `: ${p.error}` : ''}`);
    await this.client?.publishAsync(this.topic('ota/progress'), JSON.stringify(p), { qos: 1 });
  }

  /** Like the firmware library: one update at a time, the image checked before it is "flashed". */
  private async update(buf: Buffer): Promise<void> {
    const msg = JSON.parse(buf.toString()) as OtaMessage;
    if (this.updating === msg.jobId) return; // resent after a reconnect
    if (msg.version === this.version) return this.progress({ version: msg.version, state: 'applied', pct: 100 });
    if (this.updating) return;
    this.updating = msg.jobId;
    try {
      await this.progress({ version: msg.version, state: 'downloading', pct: 0 });
      const res = await fetch(msg.url);
      if (!res.ok) return await this.progress({ version: msg.version, state: 'failed', error: `download failed (HTTP ${res.status})` });
      const image = Buffer.from(await res.arrayBuffer());
      await this.progress({ version: msg.version, state: 'downloading', pct: 100 });
      if (image.length !== msg.size) return await this.progress({ version: msg.version, state: 'failed', error: 'size mismatch' });
      await this.progress({ version: msg.version, state: 'verifying', pct: 100 });
      if (createHash('sha256').update(image).digest('hex') !== msg.sha256) {
        return await this.progress({ version: msg.version, state: 'failed', error: 'checksum mismatch' });
      }
      await this.progress({ version: msg.version, state: 'applied', pct: 100 });
      // "Reboot": reconnect running the new version, which reports it as fw.
      await this.client?.endAsync();
      this.version = msg.version;
      this.client = await this.connect();
      this.o.onOta?.(`running ${msg.version}`);
    } finally {
      this.updating = null;
    }
  }

  private async postHttp(payload: string): Promise<void> {
    const res = await fetch(`${this.o.apiUrl.replace(/\/$/, '')}/api/v1/device/telemetry`, {
      method: 'POST',
      headers: { 'x-device-token': this.o.token, 'content-type': 'application/json' },
      body: payload,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}
